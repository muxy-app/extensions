// File-type icons in the two themes the tree offers. Lookups return a small
// cached value (markup or a data URI) so the virtualized tree can swap a
// recycled row's icon with one property write.

import { BY_EXTENSION, BY_FILENAME, DEFAULT_FILE, DEFAULT_FOLDER, ICON_SVG } from "@/shared/material-icons.generated";
import { file_type } from "@/shared/file-types";

const DOC = { d: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" };
const DOC_FOLD = { d: "M14 3v6h6" };

const STROKE = {
  plain: [DOC, DOC_FOLD],
  code: [DOC, DOC_FOLD, { d: "M10.5 13l-1.5 1.5 1.5 1.5" }, { d: "M14 13l1.5 1.5-1.5 1.5" }],
  markup: [DOC, DOC_FOLD, { d: "M8 13h8" }, { d: "M8 16h5" }],
  style: [DOC, DOC_FOLD, { d: "M8.5 17c0-2 1.5-2.5 3-3.5s2-2 2-2" }, { kind: "circle", cx: "14.5", cy: "12", r: "1" }],
  config: [DOC, DOC_FOLD, { d: "M8 13h2" }, { d: "M12 13h4" }, { d: "M8 16h2" }, { d: "M12 16h4" }],
  settings: [
    DOC,
    DOC_FOLD,
    { kind: "circle", cx: "12", cy: "15", r: "2" },
    { d: "M12 11.5v1.5M12 17v1.5M8.7 13l1.3.8M14 16.2l1.3.8M8.7 17l1.3-.8M14 13.8l1.3-.8" },
  ],
  image: [
    { kind: "rect", x: "3", y: "5", width: "18", height: "14", rx: "2" },
    { kind: "circle", cx: "8.5", cy: "10", r: "1.5" },
    { d: "M21 16l-5-5-7 7" },
  ],
  archive: [DOC, DOC_FOLD, { d: "M12 3v3M12 8v2M12 12v2M12 16v3" }],
  shell: [{ kind: "rect", x: "3", y: "4", width: "18", height: "16", rx: "2" }, { d: "M7 9l3 3-3 3" }, { d: "M13 15h4" }],
  database: [
    { kind: "ellipse", cx: "12", cy: "6", rx: "7", ry: "3" },
    { d: "M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" },
    { d: "M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" },
  ],
  lock: [{ kind: "rect", x: "5", y: "11", width: "14", height: "10", rx: "2" }, { d: "M8 11V7a4 4 0 0 1 8 0v4" }],
  box: [{ d: "M21 8l-9-5-9 5 9 5 9-5z" }, { d: "M3 8v8l9 5 9-5V8" }, { d: "M12 13v8" }],
  build: [{ d: "M14 7l3-3 3 3-3 3z" }, { d: "M15 9l-9 9-3 1 1-3 9-9" }],
  seal: [{ kind: "circle", cx: "12", cy: "10", r: "6" }, { d: "M9.5 10l2 2 3-3.5" }, { d: "M9 15l-1.5 5L12 18l4.5 2L15 15" }],
  ignore: [
    { d: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" },
    { kind: "circle", cx: "12", cy: "12", r: "2.5" },
    { d: "M4 4l16 16" },
  ],
  folder: [{ d: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" }],
  folderOpen: [{ d: "M3 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1" }, { d: "M3 7v10a2 2 0 0 0 2 2h12.5a1.5 1.5 0 0 0 1.45-1.1L21 11H7.2a1.5 1.5 0 0 0-1.45 1.1L3.6 19" }],
};

function svg_markup(paths) {
  const body = paths
    .map((item) => {
      const { kind = "path", ...attrs } = item;
      return `<${kind} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(" ")}/>`;
    })
    .join("");
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

const strokeMarkup = new Map();

/** Markup for the stroke-theme glyph of a file, folder, or open folder. */
export function stroke_icon(name, kind = "file") {
  const key = kind === "file" ? (file_type(name)?.[0] ?? "plain") : kind === "open" ? "folderOpen" : "folder";
  let markup = strokeMarkup.get(key);
  if (!markup) {
    markup = svg_markup(STROKE[key]);
    strokeMarkup.set(key, markup);
  }
  return markup;
}

const materialUris = new Map();

function material_name(name) {
  const lower = name.toLowerCase();
  if (lower in BY_FILENAME) return BY_FILENAME[lower];
  for (let dot = lower.indexOf("."); dot !== -1; dot = lower.indexOf(".", dot + 1)) {
    const ext = lower.slice(dot + 1);
    if (ext in BY_EXTENSION) return BY_EXTENSION[ext];
  }
  return DEFAULT_FILE;
}

/** Data URI for the colored Material Icon Theme glyph. */
export function material_icon(name, isDirectory = false) {
  const icon = isDirectory ? DEFAULT_FOLDER : material_name(name);
  let uri = materialUris.get(icon);
  if (uri === undefined) {
    const svg = ICON_SVG[icon] ?? ICON_SVG[DEFAULT_FILE];
    uri = svg ? `data:image/svg+xml,${encodeURIComponent(svg)}` : "";
    materialUris.set(icon, uri);
  }
  return uri;
}
