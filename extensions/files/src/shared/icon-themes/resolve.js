// Picks the icon for a file or folder from a compiled theme, following VS
// Code's rules:
//   files:   fileNames (longest path match first) > fileExtensions (longest
//            first, so "d.ts" beats "ts") > languageIds > file
//   folders: folderNamesExpanded (open only) > folderNames > folderExpanded
//            (open only) > folder
// Keys can carry parent folders ("github/workflows", ".config/graphqlrc"),
// matched against the end of the entry's path. With a light color scheme the
// theme's `light` section is consulted first at every step.

import { language_id } from "@/shared/icon-themes/language-ids";

/** Splits a mapping into exact names and path-qualified keys indexed by their last segment. */
function index_names(map) {
  if (!map) return null;
  const exact = new Map();
  const paths = new Map();
  for (const [key, icon] of Object.entries(map)) {
    if (!key.includes("/")) {
      exact.set(key, icon);
      continue;
    }
    const segments = key.split("/").filter(Boolean);
    const last = segments.pop();
    if (!last) continue;
    let list = paths.get(last);
    if (!list) paths.set(last, (list = []));
    list.push({ parents: segments, icon });
  }
  for (const list of paths.values()) list.sort((a, b) => b.parents.length - a.parents.length);
  return { exact, paths };
}

function index_layer(layer) {
  if (!layer) return null;
  return {
    file: layer.file ?? null,
    folder: layer.folder ?? null,
    folderExpanded: layer.folderExpanded ?? null,
    fileNames: index_names(layer.fileNames),
    folderNames: index_names(layer.folderNames),
    folderNamesExpanded: index_names(layer.folderNamesExpanded),
    fileExtensions: layer.fileExtensions ?? null,
    languageIds: layer.languageIds ?? null,
  };
}

/** `segments` are the lowercased path parts, ending with the entry's own name. */
function match_name(index, segments) {
  if (!index) return null;
  const name = segments[segments.length - 1];
  const qualified = index.paths.get(name);
  if (qualified) {
    for (const { parents, icon } of qualified) {
      if (parents.length > segments.length - 1) continue;
      let ok = true;
      for (let i = 0; i < parents.length; i += 1) {
        if (segments[segments.length - 1 - parents.length + i] !== parents[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return icon;
    }
  }
  return index.exact.get(name) ?? null;
}

export class IconResolver {
  constructor(theme, scheme = "dark") {
    this.theme = theme;
    this.base = index_layer(theme.dark);
    this.light = index_layer(theme.light);
    this.setScheme(scheme);
  }

  setScheme(scheme) {
    this.scheme = scheme === "light" ? "light" : "dark";
    this.layers = this.scheme === "light" && this.light ? [this.light, this.base] : [this.base];
  }

  /** The icon ID for an entry, or null when the theme has nothing for it. */
  iconId(path, isDirectory, open = false) {
    const segments = String(path)
      .toLowerCase()
      .split("/")
      .filter(Boolean);
    if (segments.length === 0) return null;
    const { layers } = this;

    if (isDirectory) {
      if (open) for (const l of layers) {
        const hit = match_name(l.folderNamesExpanded, segments);
        if (hit) return hit;
      }
      for (const l of layers) {
        const hit = match_name(l.folderNames, segments);
        if (hit) return hit;
      }
      if (open) for (const l of layers) if (l.folderExpanded) return l.folderExpanded;
      for (const l of layers) if (l.folder) return l.folder;
      return null;
    }

    for (const l of layers) {
      const hit = match_name(l.fileNames, segments);
      if (hit) return hit;
    }
    const name = segments[segments.length - 1];
    for (let dot = name.indexOf("."); dot !== -1; dot = name.indexOf(".", dot + 1)) {
      const ext = name.slice(dot + 1);
      for (const l of layers) {
        const hit = l.fileExtensions?.[ext];
        if (hit) return hit;
      }
    }
    const language = language_id(name);
    if (language) for (const l of layers) {
      const hit = l.languageIds?.[language];
      if (hit) return hit;
    }
    for (const l of layers) if (l.file) return l.file;
    return null;
  }

  icon(path, isDirectory, open = false) {
    const id = this.iconId(path, isDirectory, open);
    return id ? { id, ...this.theme.icons[id] } : null;
  }
}
