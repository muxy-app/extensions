// Maps a file path to an SF Symbol name for the editor tab icon
// (muxy.tabs.setIcon({ symbol })). Keyed by extension first, then a few
// well-known basenames, with a generic document fallback. Symbols are chosen
// from SF Symbols that ship on macOS so they always resolve in the tab bar.

import { basename } from "@/lib/files";

const GENERIC = "doc.text";

// Extension → SF Symbol. Grouped by family; many extensions share a symbol.
const BY_EXT: Record<string, string> = {
  // Markup / docs
  md: "doc.richtext",
  markdown: "doc.richtext",
  mdx: "doc.richtext",
  txt: "doc.text",
  rtf: "doc.text",
  pdf: "doc.text.image",
  // Web / markup languages
  html: "chevron.left.forwardslash.chevron.right",
  htm: "chevron.left.forwardslash.chevron.right",
  xml: "chevron.left.forwardslash.chevron.right",
  svg: "photo",
  css: "paintbrush",
  scss: "paintbrush",
  sass: "paintbrush",
  less: "paintbrush",
  // JS / TS family
  js: "curlybraces",
  jsx: "curlybraces",
  ts: "curlybraces",
  tsx: "curlybraces",
  mjs: "curlybraces",
  cjs: "curlybraces",
  // Data / config
  json: "curlybraces",
  jsonc: "curlybraces",
  yaml: "list.bullet.indent",
  yml: "list.bullet.indent",
  toml: "list.bullet.indent",
  ini: "gearshape",
  env: "gearshape",
  conf: "gearshape",
  // Languages
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
  // Images
  png: "photo",
  jpg: "photo",
  jpeg: "photo",
  gif: "photo",
  webp: "photo",
  bmp: "photo",
  ico: "photo",
  // Archives / binaries
  zip: "doc.zipper",
  tar: "doc.zipper",
  gz: "doc.zipper",
  // Lockfiles / package metadata
  lock: "lock.doc",
};

// Exact basename (lowercased) → SF Symbol, for files without a telling extension.
const BY_NAME: Record<string, string> = {
  dockerfile: "shippingbox",
  makefile: "hammer",
  "license": "checkmark.seal",
  ".gitignore": "eye.slash",
  ".gitattributes": "gearshape",
  ".env": "gearshape",
};

/** SF Symbol name for a file path's editor-tab icon. */
export function icon_for(path: string): string {
  const name = basename(path).toLowerCase();
  if (name in BY_NAME) return BY_NAME[name];
  const dot = name.lastIndexOf(".");
  if (dot > 0) {
    const ext = name.slice(dot + 1);
    if (ext in BY_EXT) return BY_EXT[ext];
  }
  return GENERIC;
}
