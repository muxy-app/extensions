// Syntax highlighting for Dockerfiles. Returns one HTML string per line, so
// the preview can number lines and the editor can lay it under its text.

const KEYWORDS = new Set([
  "FROM", "RUN", "CMD", "LABEL", "MAINTAINER", "EXPOSE", "ENV", "ADD", "COPY", "ENTRYPOINT",
  "VOLUME", "USER", "WORKDIR", "ARG", "ONBUILD", "STOPSIGNAL", "HEALTHCHECK", "SHELL",
]);
const HEREDOC_KEYWORDS = new Set(["RUN", "COPY", "ADD"]);

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
const span = (cls, text) => (text ? `<span class="tk-${cls}">${esc(text)}</span>` : "");

// Strings, variables, --flags, and a trailing line continuation.
const TOKEN_RE = /("(?:[^"\\]|\\.)*"?|'[^']*'?)|(\$\{[^}]*\}?|\$[A-Za-z_]\w*)|(^|\s)(--[\w-]+(?:=\S*)?)|(\\\s*$)/g;

function tokens(text) {
  let html = "";
  let last = 0;
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text))) {
    html += esc(text.slice(last, m.index));
    if (m[1]) html += span("str", m[1]);
    else if (m[2]) html += span("var", m[2]);
    else if (m[4]) html += esc(m[3]) + span("flag", m[4]);
    else if (m[5]) html += span("op", m[5]);
    last = m.index + m[0].length;
  }
  return html + esc(text.slice(last));
}

export function highlightDockerfile(text) {
  let cont = false;
  let heredoc = null;
  return String(text ?? "")
    .split("\n")
    .map((line) => {
      if (heredoc) {
        if ((heredoc.strip ? line.replace(/^\t+/, "") : line).trimEnd() === heredoc.word) {
          heredoc = null;
          return span("kw", line);
        }
        return span("str", line);
      }
      if (/^\s*#/.test(line)) return span("comment", line);

      let html = "";
      let rest = line;
      let kw = "";
      if (!cont) {
        const m = /^(\s*)([A-Za-z]+)(?=\s|$)/.exec(line);
        if (m && KEYWORDS.has(m[2].toUpperCase())) {
          kw = m[2].toUpperCase();
          html = esc(m[1]) + span("kw", m[2]);
          rest = line.slice(m[0].length);
        }
      }
      const as = kw === "FROM" && /^(.*?\s)(as)(\s+)(\S+)(.*)$/i.exec(rest);
      html += as ? tokens(as[1]) + span("kw", as[2]) + esc(as[3]) + span("name", as[4]) + tokens(as[5]) : tokens(rest);

      cont = /\\\s*$/.test(line);
      const hd = HEREDOC_KEYWORDS.has(kw) && /(?:^|[^<])<<(-?)(["']?)([A-Za-z_][\w-]*)\2/.exec(line);
      if (hd) heredoc = { strip: hd[1] === "-", word: hd[3] };
      return html;
    });
}

// The highlighted file with line numbers. With lineAction, a line number is a
// button that edits from that line.
export function codeHtml(text, lineAction = "") {
  const lines = highlightDockerfile(text);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return `<div class="code">${lines
    .map((h, i) => {
      const n = i + 1;
      const ln = lineAction
        ? `<span class="ln" data-action="${lineAction}" data-line="${n}" title="Edit from line ${n}">${n}</span>`
        : `<span class="ln">${n}</span>`;
      return `<div class="cl">${ln}<span class="lc">${h || " "}</span></div>`;
    })
    .join("")}</div>`;
}
