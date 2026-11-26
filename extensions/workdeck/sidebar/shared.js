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
async function scanXita() {
  const r = await muxy.exec({ shell: XITA_SCAN, timeoutMs: 20000 });
  if (r.exitCode !== 0) return null;
  const clean = (s) => String(s || "").replace(/\\[nrt]/g, " ").replace(/\s+/g, " ").trim();
  const procs = [], sessions = [];
  for (const line of r.stdout.split("\n")) {
    const f = line.split("|");
    if (f[0] === "P" && f[1] && f[2]) procs.push({ pid: f[1], cwd: f[2], session: f[3] || null });
    else if (f[0] === "S" && f[1] && f[2]) sessions.push({ sess: f[1], cwd: f[2], state: f[3] === "working" ? "working" : "idle", mtime: Number(f[4]) || 0, title: clipText(clean(f[5]), 80), issueNum: clean(f[6]), issueTitle: clipText(clean(f[7]), 80) });
  }
  return { procs, sessions };
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
    providerID: "xita", status: s ? s.state : "idle", external: true, cwd, sess: s ? s.sess : null,
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


/* Cuts by characters, not bytes (a shell `cut` would split a Korean letter in the middle). Array.from also keeps
 * surrogate pairs such as emoji whole. */
function clipText(text, max) {
  const chars = Array.from(String(text || "").trim());
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : chars.join("");
}
