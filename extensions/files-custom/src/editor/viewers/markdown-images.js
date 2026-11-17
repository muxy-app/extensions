// Images in the markdown preview: parsing `![alt](src)` and raw `<img>` tags
// into placeholders, and deciding where each `src` loads from. Free of DOM and
// host calls so it can be unit-tested in Node.
import { escape_html } from "@/shared/dom";
import { resolve_rel } from "@/shared/paths";

// `![alt](src)`, `![alt](<path with spaces.png>)`, with an optional "title".
const MD_IMAGE_RE = /!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^)\s]+))(?:\s+(?:"([^"]*)"|'([^']*)'))?\s*\)/g;
const HTML_IMAGE_RE = /<img\b([^>]*?)\/?>/gi;
const ATTR_RE = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
const SIZE_RE = /^\d+(?:px|%)?$/;

// A placeholder that survives HTML escaping and the inline markdown rules.
const TOKEN = "\u0000";
const TOKEN_RE = /\u0000(\d+)\u0000/g;

export function decode_entities(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Attributes of a raw tag, lowercased, with entities decoded. */
export function parse_attrs(attrText) {
  const attrs = {};
  for (const match of attrText.matchAll(ATTR_RE)) {
    attrs[match[1].toLowerCase()] = decode_entities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  // A bare attribute such as `open` or `reversed`.
  for (const match of attrText.replace(ATTR_RE, " ").matchAll(/(?:^|\s)([a-zA-Z_:][\w:.-]*)(?=\s|$)/g)) {
    const name = match[1].toLowerCase();
    if (!(name in attrs)) attrs[name] = "";
  }
  return attrs;
}

function html_image(attrText) {
  const attrs = parse_attrs(attrText);
  if (!attrs.src) return null;
  return { src: attrs.src, alt: attrs.alt ?? "", title: attrs.title ?? "", width: attrs.width, height: attrs.height };
}

/**
 * Swaps each image in a run of inline text for a placeholder. Returns the
 * text and the images; `restore_images` puts their markup back once the
 * text has been escaped and formatted.
 */
export function extract_images(text) {
  const images = [];
  const hold = (image) => {
    images.push(image);
    return `${TOKEN}${images.length - 1}${TOKEN}`;
  };
  const out = text
    .replace(HTML_IMAGE_RE, (whole, attrText) => {
      const image = html_image(attrText);
      return image ? hold(image) : whole;
    })
    .replace(MD_IMAGE_RE, (_, alt, angled, bare, dq, sq) =>
      hold({ src: angled ?? bare, alt, title: dq ?? sq ?? "" }),
    );
  return { text: out, images };
}

function size_attr(name, value) {
  if (!value || !SIZE_RE.test(value.trim())) return "";
  const size = value.trim();
  if (size.endsWith("%")) return ` style="${name}: ${size}"`;
  return ` ${name}="${Number.parseInt(size, 10)}"`;
}

export function image_markup(image) {
  const title = image.title ? ` title="${escape_html(image.title)}"` : "";
  return (
    `<img class="md-img" data-src="${escape_html(image.src)}" alt="${escape_html(image.alt)}"${title}` +
    `${size_attr("width", image.width)}${size_attr("height", image.height)}>`
  );
}

export function restore_images(html, images) {
  if (images.length === 0) return html;
  return html.replace(TOKEN_RE, (whole, index) => {
    const image = images[Number(index)];
    return image ? image_markup(image) : whole;
  });
}

/**
 * Where an image `src` loads from: `{ kind: "remote", url, host }` for a web
 * image (shown only once the user asks, since fetching it tells that server
 * the file was opened), `{ kind: "url", url }` for an inline data image,
 * `{ kind: "file", path }` for a project file (relative to the markdown file,
 * or to the project root with a leading `/`, as on GitHub), or null for
 * anything else.
 */
export function image_source(src, fromPath) {
  const value = String(src ?? "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value) || value.startsWith("//")) {
    const url = value.startsWith("//") ? `https:${value}` : value;
    try {
      return { kind: "remote", url, host: new URL(url).host };
    } catch {
      return null;
    }
  }
  if (/^data:image\//i.test(value)) return { kind: "url", url: value };
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;

  let path = value.split(/[?#]/)[0];
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep the raw path when it isn't valid percent-encoding.
  }
  if (!path) return null;
  const target = path.startsWith("/")
    ? resolve_rel("", path.replace(/^\/+/, ""))
    : resolve_rel(fromPath ?? "", path);
  return target ? { kind: "file", path: target } : null;
}
