import { basename } from "@/lib/files";
import { BY_EXTENSION, BY_FILENAME, DEFAULT_FILE, DEFAULT_FOLDER, ICON_SVG } from "@/lib/material-icons.generated";

// Renders the branded (colored) Material file icons in the tree. Each icon is
// a self-contained SVG document, so it is rendered as an <img> with a data URI
// rather than inlined into the page DOM — that keeps every icon's gradient/clip
// ids isolated (several icons reuse id="a") and its brand colors intact instead
// of being overridden by the tree's currentColor.

const ICON_PX = 14;
const data_uri_cache = new Map();

function data_uri(iconName) {
  let uri = data_uri_cache.get(iconName);
  if (uri === undefined) {
    const svg = ICON_SVG[iconName] ?? ICON_SVG[DEFAULT_FILE];
    // encodeURIComponent keeps the markup intact (no base64 needed) and is
    // smaller for these short SVGs.
    uri = svg ? `data:image/svg+xml,${encodeURIComponent(svg)}` : "";
    data_uri_cache.set(iconName, uri);
  }
  return uri;
}

function icon_name_for(path) {
  const name = basename(path).toLowerCase();
  if (name in BY_FILENAME) return BY_FILENAME[name];
  // Try each dot-suffix from longest to shortest so compound and dotfile names
  // resolve: "archive.tar.gz" → "tar.gz" then "gz"; ".env" → "env" (a leading
  // dot is treated as a real extension here, matching VS Code).
  for (let dot = name.indexOf("."); dot !== -1; dot = name.indexOf(".", dot + 1)) {
    const ext = name.slice(dot + 1);
    if (ext in BY_EXTENSION) return BY_EXTENSION[ext];
  }
  return DEFAULT_FILE;
}

function img(iconName) {
  const el = document.createElement("img");
  el.src = data_uri(iconName);
  el.width = ICON_PX;
  el.height = ICON_PX;
  el.alt = "";
  el.setAttribute("aria-hidden", "true");
  el.draggable = false;
  return el;
}

// <img> element for a file row's icon.
export function material_file_icon(path) {
  return img(icon_name_for(path));
}

// <img> element for a directory row's icon.
export function material_folder_icon() {
  return img(DEFAULT_FOLDER);
}
