export function cls(...values) {
  return values.filter(Boolean).join(" ");
}

export function h(tag, attrs = null, ...children) {
  const node = document.createElement(tag);
  if (attrs) set_attrs(node, attrs);
  append(node, children);
  return node;
}

function set_attrs(node, attrs) {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = String(value);
    else if (key === "style" && typeof value === "object") {
      for (const [name, styleValue] of Object.entries(value)) {
        if (styleValue !== null && styleValue !== undefined) node.style.setProperty(name, String(styleValue));
      }
    } else if (key === "dataset" && typeof value === "object") Object.assign(node.dataset, value);
    else if (key === "checked") node.checked = Boolean(value);
    else if (key === "value") node.value = String(value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
}

function append(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function escape_html(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** A round-stroke glyph on a 24-unit grid, drawn at `size` px. */
export function icon_svg(paths, size = 14, strokeWidth = 1.5) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", String(strokeWidth));
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const item of paths) {
    const element = document.createElementNS(SVG_NS, item.kind ?? "path");
    for (const [name, value] of Object.entries(item)) {
      if (name !== "kind") element.setAttribute(name, String(value));
    }
    svg.appendChild(element);
  }
  return svg;
}
