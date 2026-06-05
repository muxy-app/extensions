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
