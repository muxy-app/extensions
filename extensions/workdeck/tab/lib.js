/* Helpers shared by the Issues and Deploys tabs. */
const $ = (s, r = document) => r.querySelector(s);
const ctx = muxy.data || {}; // { name, path } of the project this tab belongs to
const norm = (p) => String(p || "").replace(/\/+$/, "");
const shellQuote = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;

/* Small persistent key-value helper over the extension storage (shared by the sidebar and every tab). */
const store = {
  async get(key, fallback) { try { const v = await muxy.storage.get(key); return v == null ? fallback : v; } catch { return fallback; } },
  set: (key, value) => muxy.storage.set(key, value),
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
}

function ago(iso) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return tr("방금");
  if (s < 3600) return tr("{0}분 전", Math.floor(s / 60));
  if (s < 86400) return tr("{0}시간 전", Math.floor(s / 3600));
  if (s < 86400 * 30) return tr("{0}일 전", Math.floor(s / 86400));
  return new Date(iso).toLocaleDateString(LOCALE);
}

/* Runs a program on the project's server and returns stdout; a non-zero exit becomes an Error with the reason. */
async function run(argv, opts = {}) {
  const r = await muxy.exec(argv, { timeoutMs: 30000, ...opts });
  if (r.exitCode !== 0) throw new Error((r.stderr || r.stdout || `exit ${r.exitCode}`).trim().slice(0, 600));
  return r.stdout;
}
/* Muxy's exec PATH usually lacks Homebrew, so the common install locations are tried before a bare `gh`. */
const GH_BINS = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "gh"];
let ghBin = null;
async function gh(args, opts) {
  const candidates = ghBin ? [ghBin] : GH_BINS;
  let last;
  for (const bin of candidates) {
    try { const out = await run([bin, ...args], opts); ghBin = bin; return out; }
    catch (e) { last = e; if (!/not found|launch|no such/i.test(String((e && e.message) || e))) { ghBin = bin; throw e; } }
  }
  throw new Error(tr("GitHub CLI(gh)를 찾지 못했어요. 설치와 로그인(gh auth login)을 확인해 주세요. ({0})", (last && last.message) || ""));
}
const ghJSON = async (args) => JSON.parse((await gh(args)) || "null");

/* owner/repo of the project's origin remote (read with git -C, so it works for any project folder). */
async function repoSlug(path) {
  const url = (await run(["git", "-C", path, "remote", "get-url", "origin"])).trim();
  const m = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url);
  if (!m) throw new Error(tr("GitHub 저장소가 아니에요 ({0})", url || tr("origin 없음")));
  return `${m[1]}/${m[2]}`;
}

const openUrl = (u) => muxy.app.openExternal(u);

/* Linear's GraphQL API. The key comes from the extension's own storage (set in Issues → 트래커 설정); the `muxy` CLI has
 * no command that reads extension storage, so an agent running in a terminal cannot get at it.
 * Before: the key was read from the user's shell profile and expanded into curl's argv, where any process of the same
 *         user could read it with `ps` — including an agent the issue text had talked into looking.
 * Now: the key travels on stdin's first line and goes to curl through `-H @-`, so it is in neither argv nor the
 *      environment. With no stored key it falls back to the shell profile, unchanged, so existing setups keep working.
 * Why: the component reading untrusted issue text must not be able to reach the credential.
 * Affects: every Linear call. The command text stays constant, so Muxy still asks to approve it once. */
const LINEAR_SHELL = `IN=$(cat); K=$(printf '%s\\n' "$IN" | head -1); Q=$(printf '%s\\n' "$IN" | tail -n +2)
if [ -n "$K" ]; then
  printf 'Authorization: %s' "$K" | curl -sS --max-time 25 https://api.linear.app/graphql -H @- -H 'Content-Type: application/json' --data "$Q"
else
  printf '%s' "$Q" | zsh -ic 'curl -sS --max-time 25 https://api.linear.app/graphql -H "Authorization: $LINEAR_API_KEY" -H "Content-Type: application/json" --data @-'
fi`;
async function trackerKey() {
  try { return String((await muxy.storage.get("trackerKeys"))?.linear || ""); } catch { return ""; }
}
async function linear(query, variables = {}) {
  const key = await trackerKey();
  const r = await muxy.exec({ shell: LINEAR_SHELL, stdin: key + "\n" + JSON.stringify({ query, variables }), timeoutMs: 40000 });
  const i = r.stdout.indexOf("{");
  if (i < 0) throw new Error((r.stderr || tr("Linear 응답이 비어 있어요")).trim().slice(0, 300));
  const body = JSON.parse(r.stdout.slice(i));
  if (body.errors && body.errors.length) {
    const msg = body.errors.map((e) => e.message).join("; ");
    throw new Error(/authenticat|api key|unauthor/i.test(msg) ? tr("Linear 인증에 실패했어요. 트래커 설정의 키 또는 셸의 LINEAR_API_KEY를 확인해 주세요.") : msg);
  }
  return body.data;
}

function chip(text, color) {
  const c = el("span", { class: "chip" }, text);
  if (color) { const hex = String(color).replace("#", ""); c.style.background = `#${hex}33`; c.style.borderColor = `#${hex}88`; }
  return c;
}

function errorBox(e) {
  return el("div", { class: "err" }, String((e && e.message) || e));
}

/* ---------- markdown: just enough for issue/PR text, built with DOM calls so nothing is injected as HTML ---------- */

function mdLink(text, url) { return el("a", { href: "#", onclick: (e) => { e.preventDefault(); openUrl(url); } }, text); }

function mdInline(text) {
  const frag = document.createDocumentFragment();
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\((https?:[^)\s]+)\))|(https?:\/\/[^\s<)]+)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    if (m[1]) frag.append(el("code", {}, m[1].slice(1, -1)));
    else if (m[2]) frag.append(el("b", {}, m[2].slice(2, -2)));
    else if (m[3]) frag.append(mdLink(m[3].slice(1, m[3].indexOf("]")), m[4]));
    else frag.append(mdLink(m[0], m[0]));
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

function renderMarkdown(src) {
  const box = el("div", { class: "md" });
  const lines = String(src || "").replace(/\r/g, "").split("\n");
  let i = 0, ul = null, para = null;
  const flush = () => { ul = null; para = null; };
  while (i < lines.length) {
    const ln = lines[i];
    if (/^```/.test(ln)) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; flush(); box.append(el("pre", { class: "code" }, buf.join("\n"))); continue;
    }
    const h = /^(#{1,4})\s+(.*)/.exec(ln);
    if (h) { flush(); box.append(el("h" + (h[1].length + 2), { class: "mdh" }, mdInline(h[2]))); i++; continue; }
    const li = /^\s*(?:[-*]|\d+\.)\s+(?:\[( |x)\]\s+)?(.*)/.exec(ln);
    if (li) {
      if (!ul) { ul = el("ul", {}); box.append(ul); para = null; }
      ul.append(el("li", {}, li[1] ? el("span", { class: "chk" }, li[1] === "x" ? "☑ " : "☐ ") : null, mdInline(li[2])));
      i++; continue;
    }
    if (/^>\s?/.test(ln)) { flush(); box.append(el("blockquote", {}, mdInline(ln.replace(/^>\s?/, "")))); i++; continue; }
    if (!ln.trim()) { flush(); i++; continue; }
    if (!para) { para = el("p", {}); box.append(para); ul = null; } else para.append(el("br"));
    para.append(mdInline(ln));
    i++;
  }
  return box;
}

/* Gives the tab its own icon (an SF Symbol) instead of Muxy's generic extension-tab icon. */
function tabIcon(symbol) {
  try { Promise.resolve(muxy.tabs.setIcon({ symbol })).catch(() => {}); } catch { /* the icon is cosmetic */ }
}
