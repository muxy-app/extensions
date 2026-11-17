// Raw HTML in markdown, as READMEs use it: centered logos, badge rows,
// <details> sections. Everything goes through an allowlist, so scripts,
// styles, frames, forms, and event handlers never reach the page.
import { escape_html } from "@/shared/dom";
import { decode_entities, extract_images, image_markup, parse_attrs } from "@/editor/viewers/markdown-images";

// Tags that start an HTML block when a line begins with them (CommonMark's
// "type 6" list, trimmed to the ones that matter here).
const BLOCK_START_TAGS = new Set([
  "address", "article", "aside", "blockquote", "caption", "center", "col", "colgroup", "dd", "details",
  "div", "dl", "dt", "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header",
  "hr", "li", "main", "nav", "ol", "p", "picture", "section", "summary", "table", "tbody", "td",
  "tfoot", "th", "thead", "tr", "ul",
]);
// Blocks whose content runs to the closing tag, blank lines included.
const RAW_TAGS = new Set(["pre", "script", "style", "textarea"]);
// Wrappers that, left open, hold the markdown blocks that follow them.
const CONTAINER_TAGS = new Set([
  "article", "aside", "blockquote", "center", "details", "div", "figure", "footer", "header", "main",
  "nav", "section",
]);

export const INLINE_TAGS = new Set([
  "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "del", "dfn", "em", "i", "ins", "kbd", "mark",
  "q", "s", "samp", "small", "span", "strike", "strong", "sub", "sup", "time", "tt", "u", "var", "wbr",
]);
const BLOCK_TAGS = new Set([
  ...BLOCK_START_TAGS, "hgroup", "pre", "rp", "rt", "ruby",
]);
// Dropped with their content; anything else unknown is unwrapped.
const DROP_TAGS = new Set([
  "audio", "base", "button", "canvas", "embed", "form", "frame", "frameset", "iframe", "input", "link",
  "math", "meta", "noscript", "object", "script", "select", "style", "svg", "template", "textarea",
  "title", "video",
]);

const GLOBAL_ATTRS = new Set(["align", "dir", "id", "lang", "title"]);
const TAG_ATTRS = {
  a: new Set(["href", "name"]),
  col: new Set(["span"]),
  colgroup: new Set(["span"]),
  details: new Set(["open"]),
  img: new Set(["alt", "height", "src", "width"]),
  li: new Set(["value"]),
  ol: new Set(["reversed", "start", "type"]),
  td: new Set(["colspan", "rowspan", "valign"]),
  th: new Set(["colspan", "rowspan", "scope", "valign"]),
  time: new Set(["datetime"]),
  ul: new Set(["type"]),
};

const TAG_RE = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*?)?)\s*(\/?)>/g;
const AUTOLINK_RE = /<((?:https?:\/\/|mailto:)[^\s<>]+)>/gi;
const TOKEN_RE = /\u0000(\d+)\u0000/g;

export function safe_href(href) {
  const trimmed = String(href ?? "").trim();
  if (/^(?:javascript|vbscript|data):/i.test(trimmed.replace(/[\s\u0000-\u001f]/g, ""))) return "#";
  return trimmed;
}

function attr_allowed(tag, name) {
  return GLOBAL_ATTRS.has(name) || TAG_ATTRS[tag]?.has(name) === true;
}

function open_tag(tag, attrs) {
  let out = `<${tag}`;
  for (const [name, value] of Object.entries(attrs)) {
    if (!attr_allowed(tag, name)) continue;
    out += ` ${name}="${escape_html(name === "href" ? safe_href(value) : value)}"`;
  }
  return `${out}>`;
}

/**
 * Swaps images, allowed inline tags, and autolinks in a run of text for
 * placeholders, and drops comments. `restore_inline_html` puts the sanitized
 * markup back after the text is escaped and formatted.
 */
export function extract_inline_html(text) {
  const { text: withImages, images } = extract_images(text);
  const markup = images.map(image_markup);
  const hold = (html) => {
    markup.push(html);
    return `\u0000${markup.length - 1}\u0000`;
  };
  const out = withImages
    .replace(AUTOLINK_RE, (_, url) => hold(`<a href="${escape_html(safe_href(url))}">${escape_html(url)}</a>`))
    .replace(TAG_RE, (whole, slash, name, attrText) => {
      if (whole.startsWith("<!--")) return "";
      const tag = name.toLowerCase();
      if (!INLINE_TAGS.has(tag)) return whole;
      return hold(slash ? `</${tag}>` : open_tag(tag, parse_attrs(attrText ?? "")));
    });
  return { text: out, markup };
}

export function restore_inline_html(html, markup) {
  if (markup.length === 0) return html;
  return html.replace(TOKEN_RE, (whole, index) => markup[Number(index)] ?? whole);
}

/** How the HTML block starting on `line` ends, or null when it isn't one. */
export function html_block_start(line) {
  const indent = /^ */.exec(line)[0].length;
  if (indent > 3) return null;
  const text = line.slice(indent);
  if (text.startsWith("<!--")) return { end: "comment" };
  const match = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(?=[\s/>]|$)/.exec(text);
  if (!match) return null;
  const tag = match[2].toLowerCase();
  if (!match[1] && RAW_TAGS.has(tag)) return { end: "raw", tag };
  if (BLOCK_START_TAGS.has(tag)) return { end: "blank" };
  return null;
}

/** The HTML block's text and the index of the line after it. */
export function collect_html_block(lines, index, start = html_block_start(lines[index])) {
  const out = [];
  const closes = (line) => {
    if (start.end === "comment") return line.includes("-->");
    if (start.end === "raw") return line.toLowerCase().includes(`</${start.tag}>`);
    return false;
  };
  while (index < lines.length) {
    const line = lines[index];
    if (start.end === "blank" && line.trim() === "") break;
    out.push(line);
    index += 1;
    if (closes(line)) break;
  }
  return { html: out.join("\n"), next: index };
}

/** Closing tags at the very start of a block (they close earlier blocks), and the rest. */
export function leading_closes(html) {
  const closes = [];
  let rest = html;
  for (;;) {
    const match = /^\s*<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>/.exec(rest);
    if (!match) break;
    closes.push(match[1].toLowerCase());
    rest = rest.slice(match[0].length);
  }
  return { closes, rest };
}

/** Wrapper tags a block opens and leaves open, outermost first. */
export function unclosed_containers(html) {
  const stack = [];
  for (const match of html.matchAll(TAG_RE)) {
    if (!match[2] || match[4]) continue;
    const tag = match[2].toLowerCase();
    if (!CONTAINER_TAGS.has(tag)) continue;
    if (!match[1]) {
      stack.push(tag);
      continue;
    }
    const open = stack.lastIndexOf(tag);
    if (open !== -1) stack.splice(open);
  }
  return stack;
}

// ---- DOM side: only called in the page. ----

function element_attrs(node) {
  const attrs = {};
  for (const attr of node.attributes) attrs[attr.name.toLowerCase()] = attr.value;
  return attrs;
}

function image_node(image) {
  if (!image.src) return null;
  const template = document.createElement("template");
  template.innerHTML = image_markup(image);
  return template.content.firstElementChild;
}

function color_scheme_matches(media, isDark) {
  if (!media) return true;
  if (/prefers-color-scheme\s*:\s*dark/i.test(media)) return isDark;
  if (/prefers-color-scheme\s*:\s*light/i.test(media)) return !isDark;
  try {
    return window.matchMedia(media).matches;
  } catch {
    return false;
  }
}

/** A <picture> becomes the one image that suits the theme, as GitHub shows it. */
function picture_node(node, isDark) {
  const fallback = node.querySelector("img");
  const base = fallback ? element_attrs(fallback) : {};
  for (const source of node.querySelectorAll("source")) {
    const srcset = source.getAttribute("srcset");
    if (!srcset || !color_scheme_matches(source.getAttribute("media"), isDark)) continue;
    const src = srcset.split(",")[0].trim().split(/\s+/)[0];
    if (src) return image_node({ ...base, alt: base.alt ?? "", src });
  }
  return fallback ? image_node({ ...base, alt: base.alt ?? "" }) : null;
}

function copy_children(from, to, isDark) {
  for (const child of from.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) to.appendChild(document.createTextNode(child.data));
    else if (child.nodeType === Node.ELEMENT_NODE) copy_element(child, to, isDark);
  }
}

function copy_element(node, to, isDark) {
  const tag = node.localName;
  if (DROP_TAGS.has(tag)) return;
  if (tag === "picture") {
    const image = picture_node(node, isDark);
    if (image) to.appendChild(image);
    return;
  }
  if (tag === "img") {
    const attrs = element_attrs(node);
    const image = image_node({ ...attrs, alt: attrs.alt ?? "" });
    if (image) {
      if (attrs.align) image.setAttribute("align", attrs.align);
      to.appendChild(image);
    }
    return;
  }
  if (!BLOCK_TAGS.has(tag) && !INLINE_TAGS.has(tag)) {
    copy_children(node, to, isDark);
    return;
  }
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(element_attrs(node))) {
    if (attr_allowed(tag, name)) element.setAttribute(name, name === "href" ? safe_href(value) : value);
  }
  copy_children(node, element, isDark);
  to.appendChild(element);
}

/** Parses an HTML block inertly and rebuilds only what the allowlist keeps. */
export function sanitize_html_block(html, isDark) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const fragment = document.createDocumentFragment();
  copy_children(template.content, fragment, isDark);
  return fragment;
}

/** The still-open `tag` element at the end of a sanitized block, if any. */
export function find_open_element(node, tag) {
  let current = node.lastChild;
  while (current) {
    if (current.nodeType === Node.ELEMENT_NODE && current.localName === tag) return current;
    current = current.lastChild;
  }
  return null;
}

export { decode_entities };
