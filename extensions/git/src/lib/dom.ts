export type Child = Node | string | number | null | undefined | false | Child[];

type AttrValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ((event: Event) => void);

type Attrs = Record<string, AttrValue>;

export function cls(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) setAttrs(node, attrs);
  append(node, children);
  return node;
}

export function setAttrs(node: HTMLElement, attrs: Attrs): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = String(value);
    else if (key === "html") node.innerHTML = String(value);
    else if (key === "disabled" && value === true) node.setAttribute("disabled", "");
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else node.setAttribute(key, String(value));
  }
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function readPref<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

export function formatNumber(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function middleTruncate(path: string, max = 44): string {
  if (path.length <= max) return path;
  const keepEnd = Math.ceil((max - 1) / 2);
  const keepStart = max - 1 - keepEnd;
  return `${path.slice(0, keepStart)}...${path.slice(path.length - keepEnd)}`;
}
