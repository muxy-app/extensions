/* Notes storage. Every note is one Markdown file under the notes folder (default ~/.workdeck/notes/<scope>/), so any
 * editor can open it; the page code reads and writes it through a few fixed shell commands (the command text never
 * changes, only the NOTES_* environment, so Muxy asks for approval once). The file is the source of truth.
 *
 *   <!-- workdeck-note {"v":1,"id":"n…","scope":"global|ws:ID|proj:ID","scopeName":"…","created":"…"} -->
 *   # Title
 *
 *   ## 2026-11-18 14:02 · m3k9x            one memo; the body runs to the next heading
 *   memo text
 *   <!-- thread {"agent":"Claude Code","state":"live","summary":"…","raw":"…","msgs":[…]} -->   chat with an agent
 *   > readable copy of the summary (ignored when reading)
 *   <!-- issue {"label":"ACM-143","url":"…"} -->
 *
 * Body lines that would look like a heading or a comment are written with a leading backslash and restored on read. */
const NOTE_ROOT_DEFAULT = "~/.workdeck/notes";
const NOTE_TITLE_QUICK = "빠른 메모";

const NS = (() => {
  const PRE = 'R="$NOTES_ROOT"; case "$R" in "~"*) R="$HOME${R#"~"}";; esac; ';
  const SH = {
    write: PRE + 'F="$R/$NOTES_FILE"; mkdir -p "$(dirname "$F")" && cat > "$F.tmp" && mv "$F.tmp" "$F"',
    read: PRE + 'cat "$R/$NOTES_FILE"',
    list: PRE + 'find "$R" -maxdepth 3 -name "*.md" -type f -not -path "*/.threads/*" 2>/dev/null | while IFS= read -r f; do printf "%s\\t%s\\t%s\\t%s\\n" "${f#"$R"/}" "$(stat -f %m "$f")" "$(grep -c "^## [0-9]" "$f")" "$(head -c 700 "$f" | tr "\\n" "\\001")"; done',
    thread: PRE + '[ -n "$HB_FILE" ] && touch "$HB_FILE"; cat "$R/.threads/$NOTES_FILE"',
    abs: PRE + 'echo "$R/$NOTES_FILE"',
    trash: PRE + 'mkdir -p "$HOME/.Trash" && mv "$R/$NOTES_FILE" "$HOME/.Trash/"',
  };
  const pad = (n) => String(n).padStart(2, "0");
  const stampOf = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const newId = (p) => p + Math.random().toString(36).slice(2, 7);
  const esc = (s) => String(s).replace(/^(\\*)(## \d|<!-- )/gm, "$1\\$2");
  const unesc = (s) => s.replace(/^\\(\\*)(## \d|<!-- )/gm, "$1$2");
  const jsonLine = (o) => JSON.stringify(o).replace(/-->/g, "--\\u003e");
  const slug = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "note";
  const scopeKey = (sc) => (sc.kind === "global" ? "global" : `${sc.kind}:${sc.id}`);
  const scopeDir = (sc) => (sc.kind === "global" ? "global" : `${sc.kind}-${slug(sc.name)}`);

  async function root() { return (await store.get("notes.root", null)) || NOTE_ROOT_DEFAULT; }
  async function sh(script, env, stdin) {
    return muxy.exec({ shell: script, env: { NOTES_ROOT: await root(), ...env }, ...(stdin != null ? { stdin } : {}), timeoutMs: 20000 });
  }

  function serialize(note) {
    const meta = { v: 1, id: note.id, scope: scopeKey(note.scope), scopeName: note.scope.name || "", created: note.created };
    const out = [`<!-- workdeck-note ${jsonLine(meta)} -->`, `# ${note.title}`, ""];
    for (const e of note.entries) {
      out.push(`## ${e.ts} · ${e.id}`, esc(e.x || ""));
      if (e.thread) {
        out.push(`<!-- thread ${jsonLine(e.thread)} -->`);
        const sum = String(e.thread.summary || "").trim();
        if (sum) out.push(`> ${e.thread.agent || ""}`, ...sum.split("\n").map((l) => `> ${l}`));
      }
      if (e.issue) out.push(`<!-- issue ${jsonLine(e.issue)} -->`);
      out.push("");
    }
    return out.join("\n");
  }

  function parse(text, file) {
    const lines = String(text).replace(/\r/g, "").split("\n");
    let meta = {}, title = "", i = 0;
    const hm = /^<!-- workdeck-note (.*) -->$/.exec(lines[0] || "");
    if (hm) { try { meta = JSON.parse(hm[1]); } catch { /* a damaged header is rebuilt on the next save */ } i = 1; }
    if (/^# /.test(lines[i] || "")) { title = lines[i].slice(2).trim(); i++; }
    const entries = [];
    let cur = null, body = [], afterThread = false;
    const finish = () => { if (cur) { cur.x = unesc(body.join("\n")).replace(/\s+$/, ""); entries.push(cur); } cur = null; body = []; afterThread = false; };
    for (; i < lines.length; i++) {
      const ln = lines[i], h = /^## (\d{4}-\d\d-\d\d \d\d:\d\d)(?: · (\S+))?\s*$/.exec(ln);
      if (h) { finish(); cur = { id: h[2] || newId("m"), ts: h[1], x: "", thread: null, issue: null }; continue; }
      if (!cur) continue;
      let m;
      if ((m = /^<!-- thread (.*) -->$/.exec(ln))) { try { cur.thread = JSON.parse(m[1]); } catch { /* unreadable thread is dropped */ } afterThread = true; continue; }
      if ((m = /^<!-- issue (.*) -->$/.exec(ln))) { try { cur.issue = JSON.parse(m[1]); } catch { /* ignore */ } continue; }
      if (afterThread && (ln.startsWith(">") || !ln.trim())) continue; // the readable copy of the summary
      afterThread = false;
      body.push(ln);
    }
    finish();
    const sk = String(meta.scope || "global"), ci = sk.indexOf(":");
    return {
      v: 1, id: meta.id || newId("n"), file: file || null, title: title || NOTE_TITLE_QUICK, created: meta.created || stampOf(),
      scope: sk === "global" ? { kind: "global", name: "" } : { kind: sk.slice(0, ci), id: sk.slice(ci + 1), name: meta.scopeName || "" },
      entries,
    };
  }

  async function read(file) { const r = await sh(SH.read, { NOTES_FILE: file }); return r.exitCode === 0 ? r.stdout : null; }
  async function load(file) { const t = await read(file); if (t == null) throw new Error(tr("노트 파일을 읽지 못했어요 ({0})", file)); return parse(t, file); }
  async function save(note) {
    if (!note.file) note.file = `${scopeDir(note.scope)}/${stampOf().slice(0, 10).replace(/-/g, "")}-${slug(note.title)}-${note.id}.md`;
    const r = await sh(SH.write, { NOTES_FILE: note.file }, serialize(note));
    if (r.exitCode !== 0) throw new Error((r.stderr || tr("노트를 저장하지 못했어요")).trim().slice(0, 300));
    return note;
  }
  const create = (scope, title) => ({ v: 1, id: newId("n"), file: null, title: title || NOTE_TITLE_QUICK, created: stampOf(), scope, entries: [] });
  const entry = (x) => ({ id: newId("m"), ts: stampOf(), x, thread: null, issue: null });

  /* The scope's running "빠른 메모" note takes the memo; it is created on first use. */
  async function quickAdd(scope, text) {
    const file = `${scopeDir(scope)}/quick.md`;
    const t = await read(file);
    const note = t == null ? Object.assign(create(scope, NOTE_TITLE_QUICK), { file }) : parse(t, file);
    const e = entry(text);
    note.entries.push(e);
    await save(note);
    return { note, entry: e };
  }

  async function list() {
    const r = await sh(SH.list, {});
    if (r.exitCode !== 0) return [];
    const out = [];
    for (const row of r.stdout.split("\n")) {
      if (!row.trim()) continue;
      const a = row.indexOf("\t"), b = row.indexOf("\t", a + 1), c = row.indexOf("\t", b + 1);
      if (c < 0) continue;
      const head = row.slice(c + 1).replace(/\x01/g, "\n"), p = parse(head + "\n", row.slice(0, a));
      out.push({ file: row.slice(0, a), mtime: Number(row.slice(a + 1, b)) * 1000, count: Number(row.slice(b + 1, c)) || 0, id: p.id, title: p.title, scope: p.scope });
    }
    return out.sort((x, y) => y.mtime - x.mtime);
  }

  async function trash(file) { const r = await sh(SH.trash, { NOTES_FILE: file }); if (r.exitCode !== 0) throw new Error((r.stderr || "").trim().slice(0, 300)); }
  async function abs(file) { const r = await sh(SH.abs, { NOTES_FILE: file }); return r.stdout.trim(); }
  async function writeThread(id, text) { return sh(SH.write, { NOTES_FILE: `.threads/${id}.md` }, text); }
  /* Reading the agent's summary doubles as the heartbeat the agent's watchdog looks for (see startHelper in notes.js). */
  async function readThread(id, hbFile) { const r = await sh(SH.thread, { NOTES_FILE: `${id}.md`, HB_FILE: hbFile || "" }); return r.exitCode === 0 ? r.stdout : null; }
  return { root, setRoot: (v) => store.set("notes.root", v), serialize, parse, read, load, save, create, entry, quickAdd, list, trash, abs, writeThread, readThread, scopeKey, scopeDir, stampOf, newId, SH };
})();
