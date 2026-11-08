// Snippets core — pure logic: data model, variables, search, secret detection,
// import/export. No DOM and no Muxy API access, so it runs in Node tests as-is.

const SCHEMA_VERSION = 1;
const ACTIONS = ['run', 'insert', 'tab'];
const COLORS = ['#7aa2f7', '#ff9e64', '#73daca', '#bb9af7', '#9ece6a', '#f7768e', '#e0af68', '#7dcfff'];
const UNGROUPED = '__ungrouped';
// {{name}} or {{name:default value}}
const VAR_RE = /\{\{\s*([A-Za-z_][\w-]*)\s*(?::([^}]*))?\}\}/g;
const SENSITIVE_VAR = /pass|pwd|secret|token|key/i;

function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function isColor(c) {
  return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
}

function firstLine(text) {
  return String(text || '').split('\n').find((l) => l.trim()) || '';
}

function emptyState() {
  return { version: SCHEMA_VERSION, groups: [], snippets: [] };
}

/** Variables whose values are never remembered and are masked while typing. */
function isSensitiveVar(name) {
  return SENSITIVE_VAR.test(String(name));
}

function sanitizeVars(v) {
  const out = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, val] of Object.entries(v)) {
    if (/^[A-Za-z_][\w-]*$/.test(k) && typeof val === 'string' && !SENSITIVE_VAR.test(k)) out[k] = val.slice(0, 500);
  }
  return out;
}

/** Coerce any stored/imported value into a valid state object. */
function normalize(raw) {
  const out = emptyState();
  if (!raw || typeof raw !== 'object') return out;
  const gSeen = new Set();
  for (const g of Array.isArray(raw.groups) ? raw.groups : []) {
    if (!g || typeof g.name !== 'string' || !g.name.trim()) continue;
    let id = typeof g.id === 'string' && g.id && g.id !== UNGROUPED ? g.id : uid('g');
    if (gSeen.has(id)) id = uid('g');
    gSeen.add(id);
    out.groups.push({
      id,
      name: g.name.trim().slice(0, 80),
      color: isColor(g.color) ? g.color : COLORS[out.groups.length % COLORS.length]
    });
  }
  const sSeen = new Set();
  for (const s of Array.isArray(raw.snippets) ? raw.snippets : []) {
    if (!s || typeof s.command !== 'string' || !s.command.trim()) continue;
    let id = typeof s.id === 'string' && s.id ? s.id : uid('s');
    if (sSeen.has(id)) id = uid('s');
    sSeen.add(id);
    const command = s.command.replace(/\r\n?/g, '\n');
    out.snippets.push({
      id,
      name: (typeof s.name === 'string' && s.name.trim() ? s.name.trim() : firstLine(command)).slice(0, 120),
      command,
      groupId: gSeen.has(s.groupId) ? s.groupId : null,
      action: ACTIONS.includes(s.action) ? s.action : 'run',
      description: typeof s.description === 'string' ? s.description.slice(0, 500) : '',
      lastVars: sanitizeVars(s.lastVars),
      updatedAt: Number.isFinite(s.updatedAt) ? s.updatedAt : 0
    });
  }
  return out;
}

// ---------- variables ----------

/** Unique variables in order of appearance: [{ name, def }] */
function parseVars(command) {
  const seen = new Map();
  String(command || '').replace(VAR_RE, (_, name, def) => {
    if (!seen.has(name)) seen.set(name, { name, def: def !== undefined ? def.trim() : null });
    else if (seen.get(name).def === null && def !== undefined) seen.get(name).def = def.trim();
    return '';
  });
  return Array.from(seen.values());
}

function valueFor(v, values) {
  const given = values && typeof values[v.name] === 'string' ? values[v.name] : '';
  if (given !== '') return given;
  return v.def !== null ? v.def : '';
}

/** Names of variables that have neither a value nor a default. */
function missingVars(command, values) {
  return parseVars(command).filter((v) => valueFor(v, values) === '').map((v) => v.name);
}

function fill(command, values) {
  const vars = new Map(parseVars(command).map((v) => [v.name, v]));
  return String(command || '').replace(VAR_RE, (_, name) => valueFor(vars.get(name), values));
}

/** Initial form values: last used values, then defaults. */
function initialValues(snippet) {
  const out = {};
  for (const v of parseVars(snippet.command)) {
    const last = snippet.lastVars && snippet.lastVars[v.name];
    out[v.name] = typeof last === 'string' && last !== '' ? last : (v.def || '');
  }
  return out;
}

// ---------- command shaping ----------

function splitLines(command) {
  return String(command || '').split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() !== '');
}

/** Text typed into the prompt without pressing Enter. Multi-line joins with && so nothing runs early. */
function toInsertText(command) {
  return splitLines(command).join(' && ');
}

function toTabCommand(command) {
  return splitLines(command).join(' && ');
}

// ---------- secrets ----------

const SECRET_PATTERNS = [
  [/\b(mysql|mariadb|mysqldump)\b[^\n]*\s-p(?!\s|$)\S+/i, 'an inline MySQL password (-pPASSWORD)'],
  [/\bsshpass\s+-p\s*\S+/i, 'an sshpass password'],
  [/\b(password|passwd|pwd)\s*[=:]\s*\S+/i, 'a password value'],
  [/\b(api[_-]?key|access[_-]?token|secret|token)\s*[=:]\s*['"]?[A-Za-z0-9_\-/+=.]{8,}/i, 'an API key or token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/, 'a GitHub token'],
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'an API secret key'],
  [/[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@/i, 'credentials inside a URL'],
  [/Authorization:\s*(Bearer|Basic)\s+[A-Za-z0-9._\-+=/]{8,}/i, 'an Authorization header']
];

/** Returns a human description of what looks secret, or null. Variables are ignored. */
function looksSecret(command) {
  const text = String(command || '').replace(VAR_RE, '');
  for (const [re, what] of SECRET_PATTERNS) if (re.test(text)) return what;
  return null;
}

// ---------- search ----------

function isSubsequence(needle, hay) {
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i === needle.length;
}

function score(snippet, groupName, query) {
  const tokens = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 1;
  const name = snippet.name.toLowerCase();
  const cmd = snippet.command.toLowerCase();
  const group = String(groupName || '').toLowerCase();
  const desc = String(snippet.description || '').toLowerCase();
  let total = 0;
  for (const t of tokens) {
    let s = 0;
    if (name.startsWith(t)) s = 100;
    else if (name.includes(t)) s = 60;
    else if (group.includes(t)) s = 30;
    else if (cmd.includes(t)) s = 25;
    else if (desc.includes(t)) s = 15;
    else if (t.length > 1 && isSubsequence(t, name)) s = 8;
    else return 0;
    total += s;
  }
  return total;
}

function groupById(state) {
  const m = new Map(state.groups.map((g) => [g.id, g]));
  m.set(UNGROUPED, { id: UNGROUPED, name: 'Ungrouped', color: '#8b90a8' });
  return m;
}

/** Sections for the panel: [{ group, items: [snippet] }] in group order. groupFilter: 'all' | group id */
function sections(state, query, groupFilter) {
  const groups = groupById(state);
  const order = state.groups.map((g) => g.id).concat([UNGROUPED]);
  const filter = groupFilter || 'all';
  return order
    .filter((gid) => filter === 'all' || gid === filter)
    .map((gid) => {
      const group = groups.get(gid);
      const items = state.snippets
        .filter((s) => (s.groupId || UNGROUPED) === gid)
        .map((s) => ({ s, score: score(s, group.name, query) }))
        .filter((x) => x.score > 0);
      if (query) items.sort((a, b) => b.score - a.score);
      return { group, items: items.map((x) => x.s) };
    })
    .filter((sec) => sec.items.length > 0);
}

/** Flat ranked results (Quick run picker): [{ snippet, group }] */
function rank(state, query, limit) {
  const groups = groupById(state);
  const res = state.snippets
    .map((s, i) => {
      const group = groups.get(s.groupId || UNGROUPED);
      return { snippet: s, group, score: score(s, group.name, query), i };
    })
    .filter((x) => x.score > 0);
  if (query) res.sort((a, b) => b.score - a.score || (b.snippet.updatedAt || 0) - (a.snippet.updatedAt || 0) || a.i - b.i);
  else res.sort((a, b) => (b.snippet.updatedAt || 0) - (a.snippet.updatedAt || 0) || a.i - b.i);
  return res.slice(0, limit || 50).map(({ snippet, group }) => ({ snippet, group }));
}

function counts(state) {
  const c = { all: state.snippets.length };
  for (const s of state.snippets) {
    const k = s.groupId || UNGROUPED;
    c[k] = (c[k] || 0) + 1;
  }
  return c;
}

// ---------- mutations (return new state) ----------

function upsertSnippet(state, input) {
  const now = Date.now();
  const patch = {};
  for (const [k, v] of Object.entries(input || {})) if (v !== undefined) patch[k] = v;
  const existing = patch.id ? state.snippets.find((s) => s.id === patch.id) : null;
  const merged = Object.assign({}, existing || { id: uid('s'), lastVars: {} }, patch, { updatedAt: existing ? existing.updatedAt : now });
  const next = normalize({ groups: state.groups, snippets: existing ? state.snippets.map((s) => (s.id === merged.id ? merged : s)) : state.snippets.concat([merged]) });
  return { state: next, snippet: next.snippets.find((s) => s.id === merged.id) };
}

function duplicateSnippet(state, id) {
  const src = state.snippets.find((s) => s.id === id);
  if (!src) return { state, snippet: null };
  const copy = Object.assign({}, src, { id: uid('s'), name: src.name + ' copy', updatedAt: 0 });
  const i = state.snippets.indexOf(src);
  const snippets = state.snippets.slice();
  snippets.splice(i + 1, 0, copy);
  return { state: Object.assign({}, state, { snippets }), snippet: copy };
}

function deleteSnippet(state, id) {
  return Object.assign({}, state, { snippets: state.snippets.filter((s) => s.id !== id) });
}

/** Records a run: bumps recency and remembers non-sensitive variable values. */
function recordUse(state, id, values) {
  return Object.assign({}, state, {
    snippets: state.snippets.map((s) =>
      s.id === id ? Object.assign({}, s, { updatedAt: Date.now(), lastVars: Object.assign({}, s.lastVars, sanitizeVars(values)) }) : s
    )
  });
}

function addGroup(state, name, color) {
  const group = { id: uid('g'), name: String(name || 'New group').trim().slice(0, 80) || 'New group', color: isColor(color) ? color : COLORS[state.groups.length % COLORS.length] };
  return { state: Object.assign({}, state, { groups: state.groups.concat([group]) }), group };
}

function updateGroup(state, id, patch) {
  return normalize({
    groups: state.groups.map((g) => (g.id === id ? Object.assign({}, g, patch, { id }) : g)),
    snippets: state.snippets
  });
}

/** Deletes a group; its snippets move to moveTo (a group id) or become ungrouped. */
function deleteGroup(state, id, moveTo) {
  const target = state.groups.some((g) => g.id === moveTo && g.id !== id) ? moveTo : null;
  return {
    version: SCHEMA_VERSION,
    groups: state.groups.filter((g) => g.id !== id),
    snippets: state.snippets.map((s) => (s.groupId === id ? Object.assign({}, s, { groupId: target }) : s))
  };
}

function moveGroup(state, id, delta) {
  const groups = state.groups.slice();
  const i = groups.findIndex((g) => g.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= groups.length) return state;
  [groups[i], groups[j]] = [groups[j], groups[i]];
  return Object.assign({}, state, { groups });
}

// ---------- import / export ----------

function exportJSON(state) {
  const clean = normalize(state);
  return JSON.stringify({
    app: 'snippets',
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    groups: clean.groups,
    snippets: clean.snippets.map(({ lastVars, updatedAt, ...rest }) => rest)
  }, null, 2);
}

/**
 * mode 'merge': groups matched by name (case-insensitive), snippets with the same id replaced.
 * mode 'replace': incoming data replaces everything.
 * Throws on invalid JSON. Returns { state, added, updated, groupsAdded }.
 */
function importJSON(text, state, mode) {
  let parsed = JSON.parse(text);
  if (Array.isArray(parsed)) parsed = { groups: [], snippets: parsed };
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.snippets)) {
    throw new Error('Expected an object with a "snippets" array.');
  }
  const incoming = normalize(parsed);
  if (mode === 'replace') return { state: incoming, added: incoming.snippets.length, updated: 0, groupsAdded: incoming.groups.length };

  const groups = state.groups.slice();
  const remap = new Map();
  let groupsAdded = 0;
  for (const g of incoming.groups) {
    const same = groups.find((x) => x.name.toLowerCase() === g.name.toLowerCase());
    if (same) remap.set(g.id, same.id);
    else {
      const id = groups.some((x) => x.id === g.id) ? uid('g') : g.id;
      groups.push(Object.assign({}, g, { id }));
      remap.set(g.id, id);
      groupsAdded++;
    }
  }
  const snippets = state.snippets.slice();
  let added = 0, updated = 0;
  for (const s of incoming.snippets) {
    const mapped = Object.assign({}, s, { groupId: s.groupId ? remap.get(s.groupId) || null : null });
    const i = snippets.findIndex((x) => x.id === s.id);
    if (i >= 0) { snippets[i] = Object.assign({}, mapped, { lastVars: snippets[i].lastVars }); updated++; }
    else { snippets.push(mapped); added++; }
  }
  return { state: normalize({ groups, snippets }), added, updated, groupsAdded };
}

export {
  SCHEMA_VERSION, ACTIONS, COLORS, UNGROUPED,
  uid, emptyState, normalize,
  parseVars, missingVars, fill, initialValues,
  splitLines, toInsertText, toTabCommand,
  looksSecret, isSensitiveVar,
  score, sections, rank, counts, groupById,
  upsertSnippet, duplicateSnippet, deleteSnippet, recordUse,
  addGroup, updateGroup, deleteGroup, moveGroup,
  exportJSON, importJSON
};
