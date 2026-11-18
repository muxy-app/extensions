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

/* XITA is not among the agents Muxy recognizes, so it is found here: running `xita` terminal processes, their working
 * folder, the Muxy terminal session they run in (MUXY_SESSION_ID in the process environment; absent outside Muxy), and its own session files (~/.xita/sessions/<id>/cwd + session.v1.jsonl). A session is working when its
 * latest event is anything but a finished turn ("turn/end" and the like) and the file was written within 15 minutes; a
 * long turn can push its "turn/start" out of the part of the file that is read, so the last event is what counts. Returns [{ pid, cwd, state }]; needs commands:exec. */
const XITA_SCAN = `ps -axo pid=,tty=,command= | awk '$2 ~ /^ttys/ && $3 ~ /(^|\\/)xita$/ { print $1 }' | while read pid; do
  cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)
  [ -n "$cwd" ] || continue
  sid=$(ps eww -p "$pid" 2>/dev/null | tr ' ' '\\n' | sed -n 's/^MUXY_SESSION_ID=//p' | head -1)
  best=""; bestm=0
  for d in "$HOME"/.xita/sessions/*/; do
    [ "$(cat "$d/cwd" 2>/dev/null)" = "$cwd" ] || continue
    m=$(stat -f %m "$d/session.v1.jsonl" 2>/dev/null || echo 0)
    [ "$m" -gt "$bestm" ] && { bestm=$m; best="$d"; }
  done
  state=idle; title=""
  if [ -n "$best" ]; then
    title=$(grep -m1 '"type":"user/message"' "$best/session.v1.jsonl" | sed -n 's/.*"text":"\\([^"]*\\)".*/\\1/p' | tr -d '|')
    last=$(tail -c 60000 "$best/session.v1.jsonl" | grep -oE '"type":"(turn|step|tool|assistant|user)/[a-z_]+"' | tail -1)
    age=$(( $(date +%s) - bestm ))
    case "$last" in '"type":"turn/start"'|'"type":"step/'*|'"type":"tool/'*|'"type":"assistant/'*|'"type":"user/'*) [ "$age" -lt 900 ] && state=working;; esac
  fi
  echo "$pid|$cwd|$state|$sid|$title"
done`;
async function scanXita() {
  const r = await muxy.exec({ shell: XITA_SCAN, timeoutMs: 15000 });
  if (r.exitCode !== 0) return [];
  return r.stdout.split("\n").filter(Boolean).map((l) => { const [pid, cwd, state, session, title] = l.split("|"); return { pid, cwd, state, session: session || null, title: clipText(title || "", 80) }; });
}

/* Puts scanned XITA processes into the same shape as Muxy's agents: the project (and worktree) whose folder contains
 * the process's working directory. `projects` is [{id, path}], `worktrees` is { projectID: [{id, path}] }. */
function xitaAsAgents(found, projects, worktrees) {
  const norm = (x) => String(x || "").replace(/\/+$/, "");
  const within = (cwd, dir) => cwd === norm(dir) || cwd.startsWith(norm(dir) + "/");
  const out = [];
  for (const f of found) {
    const cwd = norm(f.cwd);
    const p = projects.filter((x) => within(cwd, x.path)).sort((a, b) => b.path.length - a.path.length)[0];
    if (!p) continue;
    const w = (worktrees[p.id] || []).filter((x) => within(cwd, x.path)).sort((a, b) => b.path.length - a.path.length)[0];
    out.push({ projectID: p.id, worktreeID: w ? w.id : p.id, paneID: "xita:" + f.pid, providerID: "xita", status: f.state === "working" ? "working" : "idle", external: true, cwd, session: f.session, title: f.title });
  }
  return out;
}

/* Cuts by characters, not bytes (a shell `cut` would split a Korean letter in the middle). Array.from also keeps
 * surrogate pairs such as emoji whole. */
function clipText(text, max) {
  const chars = Array.from(String(text || "").trim());
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : chars.join("");
}
