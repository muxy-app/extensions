export function cls(...values) {
    return values.filter(Boolean).join(" ");
}
export function h(tag, attrs = null, ...children) {
    const node = document.createElement(tag);
    if (attrs)
        setAttrs(node, attrs);
    append(node, children);
    return node;
}
export function setAttrs(node, attrs) {
    for (const [key, value] of Object.entries(attrs)) {
        if (value === null || value === undefined || value === false)
            continue;
        if (key === "class")
            node.className = String(value);
        else if (key === "html")
            node.innerHTML = String(value);
        else if (key === "disabled" && value === true)
            node.setAttribute("disabled", "");
        else if (key.startsWith("on") && typeof value === "function") {
            node.addEventListener(key.slice(2).toLowerCase(), value);
        }
        else
            node.setAttribute(key, String(value));
    }
}
export function append(parent, children) {
    for (const child of children.flat()) {
        if (child === null || child === undefined || child === false)
            continue;
        if (Array.isArray(child))
            append(parent, child);
        else
            parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    }
}
export function readPref(key, fallback) {
    try {
        return localStorage.getItem(key) || fallback;
    }
    catch {
        return fallback;
    }
}
export function writePref(key, value) {
    try {
        localStorage.setItem(key, value);
    }
    catch {
        return;
    }
}
export function clear(node) {
    node.replaceChildren();
}
export function formatNumber(n) {
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
export function middleTruncate(path, max = 44) {
    if (path.length <= max)
        return path;
    const keepEnd = Math.ceil((max - 1) / 2);
    const keepStart = max - 1 - keepEnd;
    return `${path.slice(0, keepStart)}...${path.slice(path.length - keepEnd)}`;
}
