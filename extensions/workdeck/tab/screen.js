/* Renders a terminal screen's text as readable blocks (used by the control room and the notes helper). */
/* The terminal screen as readable blocks instead of raw text: prompts, replies (markdown), tool lines, choice lists
 * and the status footer each get their own look. Anything not recognised falls back to markdown text. */
function renderScreen(text) {
  const blocks = [];
  let cur = null;
  const start = (kind, line) => { cur = { kind, lines: [line] }; blocks.push(cur); };
  for (let raw of text.split("\n")) {
    raw = raw.replace(/^[\s]*[│┃][ ]?/, "").replace(/[ ]?[│┃]\s*$/, "").replace(/^[╭╰][─╮╯]*\s*$/, "");
    // a rule drawn around a title ("──── title ────") keeps the title; a line of only rule is dropped
    if (/[─━═╌╍┄┈]{3,}/.test(raw)) raw = raw.replace(/[─━═╌╍┄┈]{3,}/g, " ").trim();
    if (!raw.trim()) { cur = null; continue; }
    if (/^\s*[❯›]?\s*\d+[.)]\s/.test(raw)) { if (cur && cur.kind === "options") cur.lines.push(raw); else start("options", raw); }
    else if (/^\s*[❯>]\s/.test(raw) || /^\s*❯\s*$/.test(raw)) start("user", raw.replace(/^\s*[❯>]\s?/, ""));
    else if (/^\s*[●⏺]\s/.test(raw)) start("ai", raw.replace(/^\s*[●⏺]\s/, ""));
    else if (/^\s*⎿/.test(raw)) { if (cur && cur.kind === "tool") cur.lines.push(raw.replace(/^\s*⎿?\s*/, "")); else start("tool", raw.replace(/^\s*⎿\s*/, "")); }
    else if (/⏵⏵|esc to interrupt|shift\+tab|for agents|to manage|\? for shortcuts/i.test(raw)) start("foot", raw.trim());
    else if (/^\s*[✻✶✳✢✽·*]\s/.test(raw)) start("status", raw.trim());
    else if (cur && !["foot", "status"].includes(cur.kind)) cur.lines.push(raw.replace(/^ {1,2}/, ""));
    else start("text", raw);
  }
  const root = el("div", { class: "screen rendered" });
  for (const b of blocks) {
    const body = b.lines.join("\n");
    if (b.kind === "ai") root.append(el("div", { class: "bk ai" }, el("span", { class: "dot" }, "●"), renderMarkdown(body)));
    else if (b.kind === "user") root.append(el("div", { class: "bk user" }, el("span", { class: "dot" }, "❯"), el("div", {}, body)));
    else if (b.kind === "tool") root.append(el("div", { class: "bk tool" }, body));
    else if (b.kind === "options") root.append(el("div", { class: "bk opts" }, ...b.lines.map((l) => el("div", { class: "opt" + (/^\s*[❯›]/.test(l) ? " sel" : "") }, l.replace(/^\s*[❯›]\s*/, "")))));
    else if (b.kind === "foot" || b.kind === "status") root.append(el("div", { class: "bk " + b.kind }, body));
    else root.append(el("div", { class: "bk text" }, renderMarkdown(body)));
  }
  return root;
}
