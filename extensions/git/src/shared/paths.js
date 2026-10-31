export function trimSlash(path) {
  return String(path ?? "").replace(/\/+$/, "");
}

export function baseName(path) {
  const clean = trimSlash(path);
  const slash = clean.lastIndexOf("/");
  return slash === -1 ? clean : clean.slice(slash + 1);
}

export function dirName(path) {
  const clean = trimSlash(path);
  const slash = clean.lastIndexOf("/");
  return slash === -1 ? "" : clean.slice(0, slash);
}

export function samePath(a, b) {
  return trimSlash(a) === trimSlash(b);
}

export function isInside(path, root) {
  const base = trimSlash(root);
  return !!base && (path === base || String(path).startsWith(`${base}/`));
}

export function siblingPath(root, name) {
  const parent = dirName(root);
  return parent ? `${parent}/${name}` : name;
}
