// Allowlist HTML sanitizer for mandoc's -T html -O fragment output.
//
// mandoc output is generated from local files, but on a remote (SSH)
// workspace man pages are third-party content rendered in a privileged
// webview — so everything passes through here before touching innerHTML.
//
// String-level tokenizer (no DOM dependency → unit-testable under node):
// disallowed tags are dropped; a small set of dangerous containers is dropped
// *with* its contents; attributes are stripped except class, role, aria-*,
// and validated href/id (both namespaced to keep mandoc anchors working
// without colliding with page ids).

const ALLOWED = new Set([
  "div", "section", "main", "table", "tbody", "thead", "tr", "td", "th",
  "b", "i", "em", "strong", "a", "code", "pre", "var", "kbd", "samp", "mark",
  "h1", "h2", "h3", "h4", "p", "dl", "dt", "dd", "span", "ul", "ol", "li",
  "br", "hr", "wbr", "blockquote", "small", "sub", "sup",
]);

// Tags whose entire content is dropped along with the tag.
const DROP_CONTENT = new Set([
  "script", "style", "iframe", "object", "embed", "applet", "title",
  "textarea", "noscript", "svg", "math", "head", "template", "form", "select",
]);

const VOID = new Set(["br", "hr", "wbr"]);

const ID_PREFIX = "s-";

export function sanitizeHtml(html) {
  const out = [];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>|[^<]+/g;
  let skipUntil = null; // tag name whose close we are waiting for
  let m;

  while ((m = re.exec(html)) !== null) {
    const tok = m[0];

    if (tok[0] !== "<") {
      if (!skipUntil) out.push(escapeStrayLt(tok));
      continue;
    }
    if (tok.startsWith("<!--") || tok.startsWith("<![CDATA[")) continue;

    const tag = tok.match(/^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)([\s\S]*?)(\/?)\s*>$/);
    if (!tag) continue; // malformed tag → drop

    const closing = tag[1] === "/";
    const name = tag[2].toLowerCase();

    if (skipUntil) {
      if (closing && name === skipUntil) skipUntil = null;
      continue;
    }
    if (DROP_CONTENT.has(name)) {
      if (!closing && tag[4] !== "/") skipUntil = name;
      continue;
    }
    if (!ALLOWED.has(name)) continue; // unwrap: drop tag, keep contents

    if (closing) {
      if (!VOID.has(name)) out.push(`</${name}>`);
      continue;
    }

    const attrs = sanitizeAttrs(tag[3]);
    const selfClose = VOID.has(name) ? "/" : "";
    out.push(`<${name}${attrs}${selfClose}>`);
  }
  return out.join("");
}

function sanitizeAttrs(raw) {
  let result = "";
  const re = /([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*("([^"]*)"|'([^']*)'|[^\s>]+)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[3] ?? m[4] ?? m[2];

    if (name === "class" || name === "role" || /^aria-[a-z-]+$/.test(name)) {
      result += ` ${name}="${escapeAttr(value)}"`;
    } else if (name === "id") {
      result += ` id="${ID_PREFIX}${escapeAttr(value)}"`;
    } else if (name === "href") {
      const href = sanitizeHref(value);
      if (href !== null) result += ` href="${escapeAttr(href)}"`;
    }
  }
  return result;
}

function sanitizeHref(value) {
  const v = value.trim();
  if (v.startsWith("#")) return `#${ID_PREFIX}${v.slice(1)}`;
  if (/^https?:\/\//i.test(v)) return v;
  return null;
}

function escapeAttr(value) {
  return value.replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;")
    .replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeStrayLt(text) {
  // Text tokens contain no '<' by construction; nothing to do beyond
  // returning them (entities from mandoc pass through untouched).
  return text;
}
