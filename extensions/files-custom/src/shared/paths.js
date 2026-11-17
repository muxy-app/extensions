// Project-relative path helpers. Inside the extension a folder's path always
// ends in "/" and the project root is "", so a path alone says whether it is a
// folder; `muxy.files` takes and returns paths without the trailing slash.

export function strip_slash(path) {
  let end = path.length;
  while (end > 0 && path.charCodeAt(end - 1) === 47) end -= 1;
  return end === path.length ? path : path.slice(0, end);
}

export function is_dir_path(path) {
  return path === "" || path.endsWith("/");
}

export function dir_path(path) {
  const clean = strip_slash(path);
  return clean ? `${clean}/` : "";
}

export function parent_of(path) {
  const clean = strip_slash(path);
  const idx = clean.lastIndexOf("/");
  return idx === -1 ? "" : clean.slice(0, idx + 1);
}

export function basename(path) {
  const clean = strip_slash(path);
  return clean.slice(clean.lastIndexOf("/") + 1);
}

export function extname(path) {
  const name = basename(path).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot);
}

export function depth_of(path) {
  const clean = strip_slash(path);
  if (!clean) return 0;
  let depth = 1;
  for (let i = 0; i < clean.length; i += 1) if (clean.charCodeAt(i) === 47) depth += 1;
  return depth;
}

/** Every ancestor folder of `path`, outermost first, excluding the root. */
export function ancestors_of(path) {
  const out = [];
  let parent = parent_of(path);
  while (parent !== "") {
    out.push(parent);
    parent = parent_of(parent);
  }
  return out.reverse();
}

export function is_within(path, dir) {
  return dir === "" || (path !== dir && path.startsWith(dir));
}

/** Splits a file name into stem and extension the way Finder selects it. */
export function split_name(name, isFolder) {
  if (isFolder) return { stem: name, ext: "" };
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

/** Resolves a relative link target against the file it appears in. */
export function resolve_rel(fromRel, target) {
  if (target.startsWith("/")) return null;
  const base = parent_of(fromRel).split("/").filter(Boolean);
  for (const segment of strip_slash(target).split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (base.length === 0) return null;
      base.pop();
      continue;
    }
    base.push(segment);
  }
  return base.join("/");
}

/**
 * Turns a `file.changed` payload into a project-relative path. The host sends
 * the absolute `path` and the watched `projectPath`; the root itself (a
 * rescan) maps to "". Returns null for another project's change.
 */
export function changed_rel(payload, root = null) {
  if (!payload || typeof payload !== "object") return null;
  const path = typeof payload.path === "string" ? payload.path : null;
  const projectPath = strip_slash(typeof payload.projectPath === "string" ? payload.projectPath : "");
  if (!path || !projectPath) return null;
  if (root !== null && strip_slash(root) !== projectPath) return null;
  if (path === projectPath || path === `${projectPath}/`) return "";
  if (!path.startsWith(`${projectPath}/`)) return null;
  return strip_slash(path.slice(projectPath.length + 1));
}
