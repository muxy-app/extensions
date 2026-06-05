export function cls(...values) {
  return values.filter(Boolean).join(" ");
}

export function clear(node) {
  node.replaceChildren();
}

export function h(tag, attrs = null, ...children) {
  const node = document.createElement(tag);
  if (attrs) setAttrs(node, attrs);
  append(node, children);
  return node;
}

export function setAttrs(node, attrs) {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = String(value);
    else if (key === "html") node.innerHTML = String(value);
    else if (key === "style" && typeof value === "object") {
      for (const [name, styleValue] of Object.entries(value)) {
        if (styleValue !== null && styleValue !== undefined) node.style.setProperty(name, String(styleValue));
      }
    } else if (key === "dataset" && typeof value === "object") {
      Object.assign(node.dataset, value);
    } else if (key === "checked") {
      node.checked = Boolean(value);
      if (value) node.setAttribute("checked", "");
    } else if (key === "disabled" && value === true) {
      node.setAttribute("disabled", "");
    } else if (key === "value") {
      node.value = String(value);
      node.setAttribute("value", String(value));
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node.setAttribute(key, String(value));
    }
  }
}

export function append(parent, children) {
  for (const child of children.flat()) {
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

export function icon_svg(paths) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");

  for (const item of paths) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", item.kind ?? "path");
    for (const [name, value] of Object.entries(item.attrs ?? item)) {
      if (name === "kind" || name === "attrs") continue;
      element.setAttribute(name, String(value));
    }
    svg.appendChild(element);
  }

  return svg;
}

export function read_pref(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

export function write_pref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }
}
