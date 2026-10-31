export function cls(...values) {
  return values.filter(Boolean).join(" ");
}

export function h(tag, attrs = null, ...children) {
  const node = document.createElement(tag);
  if (attrs) setAttrs(node, attrs);
  append(node, children);
  return node;
}

function setAttrs(node, attrs) {
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

export function append(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function setText(node, text) {
  const value = String(text ?? "");
  if (node.textContent !== value) node.textContent = value;
}

export function toggle(node, hidden) {
  if (node.hidden !== hidden) node.hidden = hidden;
}

export function fill(node, ...children) {
  node.replaceChildren();
  append(node, children);
  return node;
}
