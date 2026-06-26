import { basename } from "@/lib/files";

const GENERIC = "doc.text";

const BY_EXT = {
  md: "doc.richtext",
  markdown: "doc.richtext",
  mdx: "doc.richtext",
  txt: "doc.text",
  rtf: "doc.text",
  pdf: "doc.text.image",
  html: "chevron.left.forwardslash.chevron.right",
  htm: "chevron.left.forwardslash.chevron.right",
  xml: "chevron.left.forwardslash.chevron.right",
  svg: "photo",
  css: "paintbrush",
  scss: "paintbrush",
  sass: "paintbrush",
  less: "paintbrush",
  js: "curlybraces",
  jsx: "curlybraces",
  ts: "curlybraces",
  tsx: "curlybraces",
  mjs: "curlybraces",
  cjs: "curlybraces",
  json: "curlybraces",
  jsonc: "curlybraces",
  yaml: "list.bullet.indent",
  yml: "list.bullet.indent",
  toml: "list.bullet.indent",
  ini: "gearshape",
  env: "gearshape",
  conf: "gearshape",
  swift: "swift",
  py: "chevron.left.forwardslash.chevron.right",
  rb: "chevron.left.forwardslash.chevron.right",
  go: "chevron.left.forwardslash.chevron.right",
  rs: "chevron.left.forwardslash.chevron.right",
  java: "cup.and.saucer",
  kt: "chevron.left.forwardslash.chevron.right",
  c: "chevron.left.forwardslash.chevron.right",
  h: "chevron.left.forwardslash.chevron.right",
  cpp: "chevron.left.forwardslash.chevron.right",
  hpp: "chevron.left.forwardslash.chevron.right",
  cs: "chevron.left.forwardslash.chevron.right",
  php: "chevron.left.forwardslash.chevron.right",
  sh: "terminal",
  bash: "terminal",
  zsh: "terminal",
  fish: "terminal",
  sql: "cylinder",
  png: "photo",
  jpg: "photo",
  jpeg: "photo",
  gif: "photo",
  webp: "photo",
  bmp: "photo",
  ico: "photo",
  zip: "doc.zipper",
  tar: "doc.zipper",
  gz: "doc.zipper",
  lock: "lock.doc",
};

const BY_NAME = {
  dockerfile: "shippingbox",
  makefile: "hammer",
  license: "checkmark.seal",
  ".gitignore": "eye.slash",
  ".gitattributes": "gearshape",
  ".env": "gearshape",
};

export function icon_for(path) {
  const name = basename(path).toLowerCase();
  if (name in BY_NAME) return BY_NAME[name];
  const dot = name.lastIndexOf(".");
  if (dot > 0) {
    const ext = name.slice(dot + 1);
    if (ext in BY_EXT) return BY_EXT[ext];
  }
  return GENERIC;
}

const DOC = { d: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" };
const DOC_FOLD = { d: "M14 3v6h6" };

const CODE = [DOC, DOC_FOLD, { d: "M10.5 13l-1.5 1.5 1.5 1.5" }, { d: "M14 13l1.5 1.5-1.5 1.5" }];
const MARKUP = [DOC, DOC_FOLD, { d: "M8 13h8" }, { d: "M8 16h5" }];
const STYLE = [DOC, DOC_FOLD, { d: "M8.5 17c0-2 1.5-2.5 3-3.5s2-2 2-2" }, { kind: "circle", cx: "14.5", cy: "12", r: "1" }];
const CONFIG = [DOC, DOC_FOLD, { d: "M8 13h2" }, { d: "M12 13h4" }, { d: "M8 16h2" }, { d: "M12 16h4" }];
const SETTINGS = [DOC, DOC_FOLD, { kind: "circle", cx: "12", cy: "15", r: "2" }, { d: "M12 11.5v1.5M12 17v1.5M8.7 13l1.3.8M14 16.2l1.3.8M8.7 17l1.3-.8M14 13.8l1.3-.8" }];
const IMAGE = [
  { kind: "rect", x: "3", y: "5", width: "18", height: "14", rx: "2" },
  { kind: "circle", cx: "8.5", cy: "10", r: "1.5" },
  { d: "M21 16l-5-5-7 7" },
];
const ARCHIVE = [DOC, DOC_FOLD, { d: "M12 3v3M12 8v2M12 12v2M12 16v3" }];
const SHELL = [{ kind: "rect", x: "3", y: "4", width: "18", height: "16", rx: "2" }, { d: "M7 9l3 3-3 3" }, { d: "M13 15h4" }];
const DATABASE = [
  { kind: "ellipse", cx: "12", cy: "6", rx: "7", ry: "3" },
  { d: "M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" },
  { d: "M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" },
];
const LOCK = [{ kind: "rect", x: "5", y: "11", width: "14", height: "10", rx: "2" }, { d: "M8 11V7a4 4 0 0 1 8 0v4" }];
const BOX = [{ d: "M21 8l-9-5-9 5 9 5 9-5z" }, { d: "M3 8v8l9 5 9-5V8" }, { d: "M12 13v8" }];
const BUILD = [{ d: "M14 7l3-3 3 3-3 3z" }, { d: "M15 9l-9 9-3 1 1-3 9-9" }];
const SEAL = [{ kind: "circle", cx: "12", cy: "10", r: "6" }, { d: "M9.5 10l2 2 3-3.5" }, { d: "M9 15l-1.5 5L12 18l4.5 2L15 15" }];
const IGNORE = [{ d: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" }, { kind: "circle", cx: "12", cy: "12", r: "2.5" }, { d: "M4 4l16 16" }];
const PLAIN = [DOC, DOC_FOLD];

const PATHS_BY_EXT = {
  js: CODE, jsx: CODE, ts: CODE, tsx: CODE, mjs: CODE, cjs: CODE,
  py: CODE, rb: CODE, go: CODE, rs: CODE, java: CODE, kt: CODE,
  c: CODE, h: CODE, cpp: CODE, hpp: CODE, cs: CODE, php: CODE,
  swift: CODE, html: CODE, htm: CODE, xml: CODE,
  md: MARKUP, markdown: MARKUP, mdx: MARKUP, txt: MARKUP, rtf: MARKUP, pdf: MARKUP,
  css: STYLE, scss: STYLE, sass: STYLE, less: STYLE,
  json: CONFIG, jsonc: CONFIG, yaml: CONFIG, yml: CONFIG, toml: CONFIG,
  ini: SETTINGS, env: SETTINGS, conf: SETTINGS,
  svg: IMAGE, png: IMAGE, jpg: IMAGE, jpeg: IMAGE, gif: IMAGE, webp: IMAGE, bmp: IMAGE, ico: IMAGE,
  zip: ARCHIVE, tar: ARCHIVE, gz: ARCHIVE,
  sh: SHELL, bash: SHELL, zsh: SHELL, fish: SHELL,
  sql: DATABASE,
  lock: LOCK,
};

const PATHS_BY_NAME = {
  dockerfile: BOX,
  makefile: BUILD,
  license: SEAL,
  ".gitignore": IGNORE,
  ".gitattributes": SETTINGS,
  ".env": SETTINGS,
};

export const FOLDER_PATHS = [{ d: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" }];

export function icon_paths_for(path) {
  const name = basename(path).toLowerCase();
  if (name in PATHS_BY_NAME) return PATHS_BY_NAME[name];
  const dot = name.lastIndexOf(".");
  if (dot > 0) {
    const ext = name.slice(dot + 1);
    if (ext in PATHS_BY_EXT) return PATHS_BY_EXT[ext];
  }
  return PLAIN;
}
