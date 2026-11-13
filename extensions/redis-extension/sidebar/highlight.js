// Pretty-prints JSON from its source text, so big integers and number
// formats stay exactly as stored (JSON.parse would round 2^53+ ids).

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

export function looksJson(s) {
  if (typeof s !== "string" || s.length > 4 * 1024 * 1024) return false;
  const t = s.trim();
  if (!t || !((t[0] === "{" && t.endsWith("}")) || (t[0] === "[" && t.endsWith("]")))) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

// Returns the indented text (or highlighted HTML), or null when it isn't JSON.
export function prettyJson(text, { html = false } = {}) {
  const s = String(text ?? "");
  try {
    JSON.parse(s);
  } catch {
    return null;
  }
  const wrap = html ? (cls, t) => `<span class="${cls}">${esc(t)}</span>` : (_cls, t) => t;
  const isWs = (c) => c === " " || c === "\n" || c === "\r" || c === "\t";
  let out = "";
  let depth = 0;
  let i = 0;
  const n = s.length;
  const nl = () => "\n" + "  ".repeat(depth);
  while (i < n) {
    const c = s[i];
    if (isWs(c)) {
      i++;
    } else if (c === '"') {
      let j = i + 1;
      while (j < n && s[j] !== '"') j += s[j] === "\\" ? 2 : 1;
      const str = s.slice(i, j + 1);
      i = j + 1;
      let k = i;
      while (k < n && isWs(s[k])) k++;
      out += wrap(s[k] === ":" ? "j-key" : "j-str", str);
    } else if (c === "{" || c === "[") {
      let k = i + 1;
      while (k < n && isWs(s[k])) k++;
      if (s[k] === (c === "{" ? "}" : "]")) {
        out += c + s[k];
        i = k + 1;
      } else {
        depth++;
        out += c + nl();
        i++;
      }
    } else if (c === "}" || c === "]") {
      depth--;
      out += nl() + c;
      i++;
    } else if (c === ",") {
      out += "," + nl();
      i++;
    } else if (c === ":") {
      out += ": ";
      i++;
    } else {
      let j = i;
      while (j < n && !isWs(s[j]) && !",:]}[{\"".includes(s[j])) j++;
      const lit = s.slice(i, j);
      i = j;
      out += wrap(lit === "null" ? "j-null" : lit === "true" || lit === "false" ? "j-bool" : "j-num", lit);
    }
  }
  return out;
}
