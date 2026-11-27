/* Helpers shared by the sidebar page and the sidebar-switcher popover. */

/* The extension's PATH usually lacks `muxy`, so the app's bundled binary is tried first. */
const MUXY_BINS = ["/Applications/Muxy.app/Contents/MacOS/muxy", "muxy"];
async function muxyCLI(args, opts) {
  let last;
  for (const bin of MUXY_BINS) {
    try { return await muxy.exec([bin, ...args], opts); }
    catch (e) { last = e; if (!/not found|launch|no such/i.test(String((e && e.message) || e))) throw e; }
  }
  throw last;
}

const BUILTIN_SIDEBAR = "";

/* The active sidebar is the app setting appearance.extension_sidebar: an extension's name, or empty for the built-in one. */
async function getActiveSidebar() {
  const r = await muxyCLI(["config", "get", "appearance.extension_sidebar", "--json"], { timeoutMs: 15000 });
  if (r.exitCode !== 0) throw new Error(r.stderr || `exit ${r.exitCode}`);
  const v = JSON.parse(r.stdout || '""');
  return typeof v === "string" ? v : BUILTIN_SIDEBAR;
}

async function setActiveSidebar(name) {
  const args = name === BUILTIN_SIDEBAR ? ["config", "unset", "appearance.extension_sidebar"] : ["config", "set", "appearance.extension_sidebar", name];
  const r = await muxyCLI(args, { timeoutMs: 20000 });
  if (r.exitCode !== 0) throw new Error((r.stderr || r.stdout || `exit ${r.exitCode}`).trim());
}

/* Built-in sidebar plus every enabled extension whose manifest declares muxy.sidebar.
 * Returns { items: [{ id, title, subtitle }], current }. */
async function listSidebars() {
  const [current, listed] = await Promise.all([getActiveSidebar(), muxyCLI(["extension", "list", "--json"], { timeoutMs: 15000 })]);
  if (listed.exitCode !== 0) throw new Error(listed.stderr || `exit ${listed.exitCode}`);
  // the CLI wraps the list: { extensions: [...], load_errors: [...] }; a bare array is accepted too
  const parsed = JSON.parse(listed.stdout || "{}");
  const exts = (Array.isArray(parsed) ? parsed : parsed.extensions || []).filter((x) => x.enabled);
  const found = [];
  // one small read per extension: plutil prints just the muxy.sidebar object, or fails when there is none
  await Promise.all(exts.map(async (x) => {
    try {
      const r = await muxy.exec(["plutil", "-extract", "muxy.sidebar", "json", "-o", "-", `${x.path}/package.json`], { timeoutMs: 10000 });
      if (r.exitCode === 0) found.push({ id: x.name, title: (JSON.parse(r.stdout) || {}).title || x.name, subtitle: x.name });
    } catch { /* no sidebar block, or unreadable manifest */ }
  }));
  found.sort((a, b) => a.title.localeCompare(b.title));
  const items = [{ id: BUILTIN_SIDEBAR, title: tr("Muxy 기본 사이드바"), subtitle: tr("내장") }, ...found];
  if (!items.some((i) => i.id === current)) items.push({ id: current, title: tr("{0} (사용할 수 없음)", current), subtitle: tr("꺼져 있거나 제거된 extension") });
  return { items, current };
}

/* XITA is not among the agents Muxy recognizes. Two things are collected here, without pairing them:
 *   P|pid|cwd                       — the running `xita` processes and their working folder
 *   S|sess|cwd|state|mtime|title|inum|ititle — every session folder of those folders, with its state and labels
 * The pairing is done in the app from the pane's status line, which prints the session id (see pairXitaByScreen).
 * Before: each process was paired with a session here, by matching the process start time to the session file's creation
 *         time. That only holds for the first session of a process: `/new` starts another session in the same process, and
 *         from then on the row carried the wrong session, so the pane match failed and the row was never highlighted.
 * Now: the scan reports processes and sessions separately and the pane decides which session a row is.
 * Why: the pane's status line is the only unambiguous link between a terminal and a XITA session.
 * Affects: XITA rows. A session counts as working when its last event is anything but a finished turn or the opening
 *          system message and the file was written within 15 minutes. Needs commands:exec. */
const XITA_SCAN = `NOW=$(date +%s)
ps -axo pid=,tty=,command= | awk '$2 ~ /^ttys/ && $3 ~ /(^|\\/)xita$/ { print $1 }' | while read pid; do
  cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)
  [ -n "$cwd" ] || continue
  [ -d "$cwd" ] || continue
  printf 'P|%s|%s|%s\\n' "$pid" "$cwd" "$(ps eww -p "$pid" 2>/dev/null | tr ' ' '\\n' | sed -n 's/^MUXY_SESSION_ID=//p' | head -1)"
done
for d in "$HOME"/.xita/sessions/*/; do
  p=\${d%/}
  f="$p/session.v1.jsonl"
  [ -f "$f" ] || continue
  m=$(stat -f %m "$f" 2>/dev/null || echo 0)
  [ $((NOW - m)) -lt 86400 ] || continue
  cwd=$(cat "$p/cwd" 2>/dev/null)
  [ -n "$cwd" ] || continue
  first=$(grep -m1 '"type":"user/message"' "$f" | grep -oE '"text":"([^"\\\\]|\\\\.)*"' | head -1 | sed 's/^"text":"//; s/"$//')
  title=$(printf '%s' "$first" | paste -sd' ' - | tr -d '|')
  inum=$(printf '%s' "$first" | sed -n 's/.*번호: \\([A-Za-z0-9#_-][A-Za-z0-9#_-]*\\).*/\\1/p' | head -1)
  ititle=$(printf '%s' "$first" | sed -n 's/.*제목: \\([^\\\\]*\\).*/\\1/p' | paste -sd' ' - | tr -d '|')
  last=$(tail -c 60000 "$f" | grep -oE '"type":"[a-z]+/[a-z_]+"' | tail -1)
  state=idle
  case "$last" in
    ''|'"type":"turn/end"'|'"type":"system/'*) ;;
    *) [ $((NOW - m)) -lt 900 ] && state=working;;
  esac
  printf 'S|%s|%s|%s|%s|%s|%s|%s\\n' "$(basename "$p")" "$cwd" "$state" "$m" "$title" "$inum" "$ititle"
done`;
function parseXitaScan(stdout) {
  const clean = (s) => String(s || "").replace(/\\[nrt]/g, " ").replace(/\s+/g, " ").trim();
  const procs = [], sessions = [];
  for (const line of String(stdout || "").split("\n")) {
    const f = line.split("|");
    if (f[0] === "P" && f[1] && f[2]) procs.push({ pid: f[1], cwd: f[2], session: f[3] || null });
    else if (f[0] === "S" && f[1] && f[2]) sessions.push({ sess: f[1], cwd: f[2], state: f[3] === "working" ? "working" : "idle", mtime: Number(f[4]) || 0, title: clipText(clean(f[5]), 80), issueNum: clean(f[6]), issueTitle: clipText(clean(f[7]), 80) });
  }
  return { procs, sessions };
}
/* Runs wherever `muxy.exec` runs: on the server of the project Muxy is showing (this Mac, or a remote connection
 * while one of its projects is selected). */
async function scanXita() {
  const r = await muxy.exec({ shell: XITA_SCAN, timeoutMs: 20000 });
  if (r.exitCode !== 0) return null;
  return parseXitaScan(r.stdout);
}
/* The same scan on one named server.
 * Before: the scan could only run where `muxy.exec` runs, so with a remote server selected this Mac was not scanned.
 * Now: `muxy exec <project> --json -- /bin/sh -c <script>` — without --host for this Mac, with --host for a remote
 *      connection — addresses one server whatever is selected.
 * Why: the local agents must not disappear when a remote server is selected, and a remote server must be readable on
 *      demand rather than by polling.
 * Affects: where the scan runs; the script and its output are unchanged. Each address is one command text, so Muxy
 *          asks for approval once per address. Returns null when the run fails. */
async function scanXitaOn(server, projectID) {
  if (!projectID) return null;
  const r = await muxyCLI([...(server ? ["--host", server.ssh] : []), "exec", projectID, "--json", "--timeout-ms", "20000", "--", "/bin/sh", "-c", XITA_SCAN]);
  if (r.exitCode !== 0) return null;
  try { const res = JSON.parse(r.stdout); return res.exit_code === 0 ? parseXitaScan(res.stdout) : null; } catch { return null; }
}

/* Issue runs work in ~/.local/share/workdeck/worktrees/<repo folder>-<hash>/<branch> (0.2.0 test builds: without the
 * hash), which no Muxy project folder contains; the repo folder name leads back to the project. A fallback only: the
 * worktrees Muxy lists are matched first. Returns { project, branch } or null. */
function issueWorktreeOwner(path, projects) {
  const m = /\/workdeck\/worktrees\/([^/]+)\/([^/]+)/.exec(path || "");
  if (!m) return null;
  const repo = m[1].replace(/-[0-9a-f]{8}$/, "");
  const project = projects.find((x) => String(x.path || "").replace(/\/+$/, "").split("/").pop() === repo);
  return project ? { project, branch: m[2] } : null;
}

/* Builds the XITA rows. A row is a pane whose status line names a XITA session: that is the only link that survives
 * `/new`, a renamed tab and two agents sharing one folder. The project (and worktree) comes from the session's folder.
 * Before: rows were built from processes and then guessed onto panes by title, so `/new` (a second session in the same
 *         process) or two identical opening lines put a row on the wrong pane and the highlight stopped following tabs.
 * Now: panes decide the row; a folder whose panes have not been read yet falls back to one row per process, taking the
 *      newest session not already used.
 * Why: the owner saw rows that could not be opened and a highlight that did not move between tabs.
 * Affects: XITA rows. `scan` is { procs, sessions }, `paneScreen` is pane id → { ids } from the status lines. */
function xitaAsAgents(scan, projects, worktrees, panes, paneScreen) {
  const norm = (x) => String(x || "").replace(/\/+$/, "");
  const within = (cwd, dir) => cwd === norm(dir) || cwd.startsWith(norm(dir) + "/");
  const longest = (list) => list.sort((a, b) => b.path.length - a.path.length)[0];
  const procs = (scan && scan.procs) || [];
  const sessions = (scan && scan.sessions) || [];
  const ownerOf = (cwd) => {
    let p = null, w = null, where = null;
    const hit = longest(projects.flatMap((x) => (worktrees[x.id] || []).filter((y) => y.path && norm(y.path) !== norm(x.path) && within(cwd, y.path)).map((y) => ({ project: x, wt: y, path: y.path }))));
    if (hit) { p = hit.project; w = hit.wt; }
    else {
      const o = issueWorktreeOwner(cwd, projects);
      if (o) { p = o.project; where = o.branch; }
      else p = longest(projects.filter((x) => within(cwd, x.path)));
      if (p) w = longest((worktrees[p.id] || []).filter((x) => within(cwd, x.path)));
    }
    return p ? { p, w, where } : null;
  };
  const row = (o, cwd, s, paneID, matched, pr) => ({
    where: o.where, projectID: o.p.id, worktreeID: o.w ? o.w.id : o.p.id, paneID, paneMatched: matched, pid: pr ? pr.pid : null,
    session: pr ? pr.session : null, // the Muxy terminal session, used by the control room
    providerID: "xita", status: s ? s.state : "idle", external: true, cwd, sess: s ? s.sess : null, mtime: s ? s.mtime : 0,
    title: s ? s.title : "", issueNum: s ? s.issueNum : "", issueTitle: s ? s.issueTitle : "",
  });
  const out = [];
  const takenSess = new Set();
  for (const p of panes || []) {
    const seen = paneScreen && paneScreen.get(p.id);
    const sess = seen && seen.ids.length ? seen.ids[seen.ids.length - 1] : null;
    if (!sess || takenSess.has(sess)) continue;
    const s = sessions.find((x) => x.sess === sess);
    if (!s) continue;
    const cwd = norm(s.cwd);
    if (!procs.some((x) => norm(x.cwd) === cwd)) continue;
    const o = ownerOf(cwd);
    if (!o) continue;
    takenSess.add(sess);
    out.push(row(o, cwd, s, p.id, true, null));
  }
  for (const pr of procs) {
    const cwd = norm(pr.cwd);
    if (out.some((a) => a.cwd === cwd)) continue; // that folder is already covered by its panes
    const o = ownerOf(cwd);
    if (!o) continue;
    const s = sessions.filter((x) => norm(x.cwd) === cwd && !takenSess.has(x.sess)).sort((a, b) => b.mtime - a.mtime)[0];
    if (s) takenSess.add(s.sess);
    out.push(row(o, cwd, s, "xita:" + pr.pid, false, pr));
  }
  return out;
}

/* Subagents of a XITA session live in <session>/agents/<child>/ with task.json (parent, kind, description) and their own
 * session log. They have no process and no pane of their own, so the process scan cannot see them.
 * Only children written within the hour are reported; the task file travels base64 so quotes and newlines in it cannot
 * break the record. The task text and report are read in full by the tab (readSubagent), not here.
 * Returns [{ child, parent, state, done, mtime, description, kind }]. Needs commands:exec. */
const XITA_CHILD_SCAN = `NOW=$(date +%s)
for d in "$HOME"/.xita/sessions/*/agents/*/; do
  p=\${d%/}
  [ -f "$p/task.json" ] || continue
  f="$p/session.v1.jsonl"
  [ -f "$f" ] || continue
  m=$(stat -f %m "$f" 2>/dev/null || echo 0)
  [ $((NOW - m)) -lt 3600 ] || continue
  last=$(tail -c 20000 "$f" | grep -oE '"type":"[a-z]+/[a-z_]+"' | tail -1)
  state=idle; done=0
  case "$last" in
    ''|'"type":"system/'*) ;;
    '"type":"turn/end"') done=1;;
    *) [ $((NOW - m)) -lt 900 ] && state=working;;
  esac
  printf '%s|%s|%s|%s|%s|%s\\n' "$(basename "$p")" "$(basename "$(dirname "$(dirname "$p")")")" "$state" "$m" "$(base64 < "$p/task.json" | tr -d '\\n')" "$done"
done`;
async function scanXitaChildren() {
  const r = await muxy.exec({ shell: XITA_CHILD_SCAN, timeoutMs: 15000 });
  if (r.exitCode !== 0) return [];
  const dec = (b64) => {
    try { return new TextDecoder("utf-8").decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))); } catch { return ""; }
  };
  const out = [];
  for (const line of r.stdout.split("\n")) {
    const [child, parent, state, mtime, task64, done] = line.split("|");
    if (!child || !parent || !task64) continue;
    let task = {};
    try { task = JSON.parse(dec(task64)); } catch { continue; }
    out.push({ child, parent, state: state === "working" ? "working" : "idle", done: done === "1", mtime: Number(mtime) || 0, description: task.description || "", kind: task.kind || "" });
  }
  return out;
}

/* Reads one subagent in full for its tab: the task file, its state, and the whole last report (no byte cut).
 * Values travel in the environment so the command text stays constant. Returns { description, kind, prompt, state, done, report }
 * or null when the folder is gone. Needs commands:exec. */
const SUBAGENT_READ = `D="$HOME/.xita/sessions/$SA_PARENT/agents/$SA_CHILD"
[ -f "$D/task.json" ] || exit 3
f="$D/session.v1.jsonl"
NOW=$(date +%s); m=$(stat -f %m "$f" 2>/dev/null || echo 0)
last=$(tail -c 20000 "$f" | grep -oE '"type":"[a-z]+/[a-z_]+"' | tail -1)
state=idle; done=0
case "$last" in
  ''|'"type":"system/'*) ;;
  '"type":"turn/end"') done=1;;
  *) [ $((NOW - m)) -lt 900 ] && state=working;;
esac
report=$(grep '"type":"assistant/message"' "$f" | tail -1 | grep -oE '"text":"([^"\\\\]|\\\\.)*"' | head -1 | sed 's/^"text":"//; s/"$//')
printf '%s|%s|%s|%s\\n' "$(base64 < "$D/task.json" | tr -d '\\n')" "$state" "$done" "$(printf '%s' "$report" | base64 | tr -d '\\n')"`;
async function readSubagent(parent, child) {
  const r = await muxy.exec({ shell: SUBAGENT_READ, env: { SA_PARENT: parent, SA_CHILD: child }, timeoutMs: 20000 });
  if (r.exitCode !== 0) return null;
  const dec = (b64) => {
    try { return new TextDecoder("utf-8").decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))); } catch { return ""; }
  };
  const [task64, state, done, report64] = String(r.stdout || "").trim().split("|");
  let task = {};
  try { task = JSON.parse(dec(task64)); } catch { return null; }
  // the report comes out of the log as a JSON string body: turn its \n and \" back into real characters
  const raw = dec(report64 || "");
  let report = raw;
  try { report = JSON.parse('"' + raw + '"'); } catch { report = raw.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"'); }
  return { description: task.description || "", kind: task.kind || "", prompt: task.prompt || "", state: state === "working" ? "working" : "idle", done: done === "1", report };
}

/* The agent never holds the tracker key. It appends what it wants posted to an outbox file; the extension reads that
 * file, checks it against what this run is allowed to do, and makes the API call itself.
 * Before: the issue prompt told the agent to call Linear with $LINEAR_API_KEY. The issue body comes from a tracker, so it
 *         can carry instructions aimed at the agent — an agent holding the key could be talked into misusing it.
 * Now: the prompt gives a file path and a line format instead of a key. Only comments and a state change on the issues
 *      this run was started for are accepted, and only the review state id the extension looked up.
 * Why: least privilege — the component that reads untrusted text must not hold the credential (confused deputy).
 * Affects: issue runs. The key stays in the user's shell, so an agent could still read it there; taking it out of the
 *          shell is a separate change to the user's environment. */
const OUTBOX_SUBDIR = ".local/share/workdeck/run";
const outboxName = (key) => "outbox-" + String(key).replace(/[^A-Za-z0-9._-]/g, "-") + ".jsonl";

/* Same call as tab/lib.js's linear(); the sidebar does not load that file, and this codebase already keeps such small
 * helpers per page (see norm). The stored key rides stdin's first line into `curl -H @-`, so it stays out of argv and the
 * environment; with no stored key it falls back to the shell profile. The command text is constant. */
const LINEAR_RELAY_SHELL = `IN=$(cat); K=$(printf '%s\\n' "$IN" | head -1); Q=$(printf '%s\\n' "$IN" | tail -n +2)
if [ -n "$K" ]; then
  printf 'Authorization: %s' "$K" | curl -sS --max-time 25 https://api.linear.app/graphql -H @- -H 'Content-Type: application/json' --data "$Q"
else
  printf '%s' "$Q" | zsh -ic 'curl -sS --max-time 25 https://api.linear.app/graphql -H "Authorization: $LINEAR_API_KEY" -H "Content-Type: application/json" --data @-'
fi`;
async function linearCall(query, variables = {}) {
  let key = "";
  try { key = String((await muxy.storage.get("trackerKeys"))?.linear || ""); } catch { key = ""; }
  const r = await muxy.exec({ shell: LINEAR_RELAY_SHELL, stdin: key + "\n" + JSON.stringify({ query, variables }), timeoutMs: 40000 });
  const i = r.stdout.indexOf("{");
  if (i < 0) throw new Error((r.stderr || "empty Linear response").trim().slice(0, 300));
  const body = JSON.parse(r.stdout.slice(i));
  if (body.errors && body.errors.length) throw new Error(body.errors.map((e) => e.message).join("; "));
  return body.data;
}

/* Reads one run's outbox and posts what it is allowed to post. `run` is { key, issues: [{id, identifier}], stateId }.
 * Handled lines are skipped by byte offset, kept in storage per run. A bad line is counted and skipped, not retried
 * forever. Returns { posted, skipped, error }. */
const OUTBOX_READ = `f="$HOME/${OUTBOX_SUBDIR}/$WD_OUTBOX"
[ -f "$f" ] || exit 0
tail -c +$((WD_OFFSET + 1)) "$f" | head -c 200000
printf '\\n@@SIZE@@%s' "$(stat -f %z "$f" 2>/dev/null || echo 0)"`;
async function relayIssueOutbox(run) {
  const marks = (await safe(() => muxy.storage.get("issueOutbox"), {})) || {};
  const offset = Number(marks[run.key]) || 0;
  const r = await safe(() => muxy.exec({ shell: OUTBOX_READ, env: { WD_OUTBOX: outboxName(run.key), WD_OFFSET: String(offset) }, timeoutMs: 15000 }), null);
  if (!r || r.exitCode !== 0) return { posted: 0, skipped: 0 };
  const at = r.stdout.lastIndexOf("\n@@SIZE@@");
  const text = at < 0 ? r.stdout : r.stdout.slice(0, at);
  const allowed = new Map((run.issues || []).map((x) => [String(x.identifier).toUpperCase(), x.id]));
  let posted = 0, skipped = 0, error = null;
  const lines = text.split("\n");
  let consumed = offset;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === lines.length - 1 && !line.trim()) break; // a partial line: leave it for the next pass
    consumed += line.length + 1;
    if (!line.trim()) continue;
    let req = null;
    try { req = JSON.parse(line); } catch { skipped++; continue; }
    const id = allowed.get(String(req.issue || "").toUpperCase());
    if (!id) { skipped++; continue; }
    try {
      if (req.kind === "comment" && typeof req.body === "string" && req.body.trim()) {
        await linearCall(`mutation($id: String!, $b: String!) { commentCreate(input: { issueId: $id, body: $b }) { success } }`, { id, b: req.body.trim().slice(0, 20000) });
        posted++;
      } else if (req.kind === "state" && run.stateId && String(req.stateId || "") === run.stateId) {
        await linearCall(`mutation($id: String!, $s: String!) { issueUpdate(id: $id, input: { stateId: $s }) { success } }`, { id, s: run.stateId });
        posted++;
      } else skipped++;
    } catch (e) { error = String((e && e.message) || e).slice(0, 200); skipped++; }
  }
  if (consumed > offset) { marks[run.key] = consumed; await safe(() => muxy.storage.set("issueOutbox", marks), null); }
  return { posted, skipped, error };
}

/* Cuts by characters, not bytes (a shell `cut` would split a Korean letter in the middle). Array.from also keeps
 * surrogate pairs such as emoji whole. */
function clipText(text, max) {
  const chars = Array.from(String(text || "").trim());
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : chars.join("");
}
