// Syntax colouring for JSON and XML/HTML, as HTML strings. `vars` (a Map)
// marks {{variables}} as known or unknown; pass null for responses.
import { esc } from "./ui.js";
import { markVars } from "./vars.js";

const JSON_RE = /("(?:\\.|[^"\\\n])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|(\{\{[^{}\n]*\}\})|([{}[\],])/g;

export function highlightJson(text, vars = null) {
  const s = String(text ?? "");
  const mark = (t) => (vars ? markVars(t, vars) : esc(t));
  let out = "";
  let last = 0;
  JSON_RE.lastIndex = 0;
  let m;
  while ((m = JSON_RE.exec(s))) {
    out += mark(s.slice(last, m.index));
    if (m[1]) {
      out += m[2] ? `<span class="t-key">${mark(m[1])}</span>${esc(m[2])}` : `<span class="t-str">${mark(m[1])}</span>`;
    } else if (m[3]) {
      out += `<span class="t-num">${m[3]}</span>`;
    } else if (m[4]) {
      out += `<span class="t-bool">${m[4]}</span>`;
    } else if (m[5]) {
      out += `<span class="t-null">null</span>`;
    } else if (m[6]) {
      out += mark(m[6]);
    } else {
      out += `<span class="t-punc">${esc(m[7])}</span>`;
    }
    last = JSON_RE.lastIndex;
  }
  return out + mark(s.slice(last));
}

const TAG_RE = /(<!--[\s\S]*?-->)|(<!\[CDATA\[[\s\S]*?\]\]>)|(<[!?/]?[A-Za-z_][^<>]*?\/?>)/g;
const ATTR_RE = /([\w:.-]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'>]+)?/g;

function tagHtml(tag, mark) {
  const m = tag.match(/^(<[!?/]?)([A-Za-z_][\w:.-]*)([\s\S]*?)(\/?>|\?>)$/);
  if (!m) return esc(tag);
  const [, open, name, attrs, close] = m;
  const a = attrs.replace(ATTR_RE, "\u0000$1\u0001$2\u0002$3\u0003");
  // escape first, then turn the markers into spans
  const body = mark(a)
    .replace(/\u0000([^\u0001]*)\u0001/g, '<span class="t-attr">$1</span>')
    .replace(/\u0002([^\u0003]*)\u0003/g, (all, v) => (v ? `<span class="t-str">${v}</span>` : ""));
  return `<span class="t-punc">${esc(open)}</span><span class="t-tag">${esc(name)}</span>${body}<span class="t-punc">${esc(close)}</span>`;
}

export function highlightMarkup(text, vars = null) {
  const s = String(text ?? "");
  const mark = (t) => (vars ? markVars(t, vars) : esc(t));
  let out = "";
  let last = 0;
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(s))) {
    out += mark(s.slice(last, m.index));
    if (m[1] || m[2]) out += `<span class="t-comment">${esc(m[0])}</span>`;
    else out += tagHtml(m[3], mark);
    last = TAG_RE.lastIndex;
  }
  return out + mark(s.slice(last));
}

export function highlight(text, language, vars = null) {
  if (language === "json") return highlightJson(text, vars);
  if (language === "xml" || language === "html") return highlightMarkup(text, vars);
  return vars ? markVars(text, vars) : esc(text);
}
