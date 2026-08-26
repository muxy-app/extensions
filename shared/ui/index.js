const SVG_NS = "http://www.w3.org/2000/svg";

const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function cls(...parts) {
  const out = [];
  for (const part of parts.flat(Infinity)) {
    if (!part) continue;
    if (typeof part === "string") {
      out.push(part);
    } else if (typeof part === "object") {
      for (const [name, on] of Object.entries(part)) {
        if (on) out.push(name);
      }
    }
  }
  return out.join(" ");
}

export function middleTruncate(value, max) {
  const text = String(value);
  if (text.length <= max) return text;
  if (max <= 1) return "…";
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

export function icon(paths, options = {}) {
  const { size = 14, strokeWidth = 1.5, className } = options;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", String(strokeWidth));
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  if (className) svg.setAttribute("class", className);
  for (const d of Array.isArray(paths) ? paths : [paths]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}
