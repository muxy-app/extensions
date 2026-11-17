// File types by name, kept apart from icons.js so the editor tab can name its
// tab icon without loading the Material icon set.

// Extension -> [stroke glyph, SF Symbol used for the editor tab icon].
const BY_EXT = {
  js: ["code", "curlybraces"], jsx: ["code", "curlybraces"], ts: ["code", "curlybraces"], tsx: ["code", "curlybraces"],
  mjs: ["code", "curlybraces"], cjs: ["code", "curlybraces"], vue: ["code", "chevron.left.forwardslash.chevron.right"],
  py: ["code", "chevron.left.forwardslash.chevron.right"], rb: ["code", "chevron.left.forwardslash.chevron.right"],
  go: ["code", "chevron.left.forwardslash.chevron.right"], rs: ["code", "chevron.left.forwardslash.chevron.right"],
  java: ["code", "cup.and.saucer"], kt: ["code", "chevron.left.forwardslash.chevron.right"],
  c: ["code", "chevron.left.forwardslash.chevron.right"], h: ["code", "chevron.left.forwardslash.chevron.right"],
  cpp: ["code", "chevron.left.forwardslash.chevron.right"], hpp: ["code", "chevron.left.forwardslash.chevron.right"],
  cs: ["code", "chevron.left.forwardslash.chevron.right"], php: ["code", "chevron.left.forwardslash.chevron.right"],
  swift: ["code", "swift"], html: ["code", "chevron.left.forwardslash.chevron.right"],
  htm: ["code", "chevron.left.forwardslash.chevron.right"], xml: ["code", "chevron.left.forwardslash.chevron.right"],
  md: ["markup", "doc.richtext"], markdown: ["markup", "doc.richtext"], mdx: ["markup", "doc.richtext"],
  txt: ["markup", "doc.text"], rtf: ["markup", "doc.text"], pdf: ["markup", "doc.text.image"],
  css: ["style", "paintbrush"], scss: ["style", "paintbrush"], sass: ["style", "paintbrush"], less: ["style", "paintbrush"],
  json: ["config", "curlybraces"], jsonc: ["config", "curlybraces"], yaml: ["config", "list.bullet.indent"],
  yml: ["config", "list.bullet.indent"], toml: ["config", "list.bullet.indent"],
  ini: ["settings", "gearshape"], env: ["settings", "gearshape"], conf: ["settings", "gearshape"],
  svg: ["image", "photo"], png: ["image", "photo"], jpg: ["image", "photo"], jpeg: ["image", "photo"],
  gif: ["image", "photo"], webp: ["image", "photo"], bmp: ["image", "photo"], ico: ["image", "photo"], avif: ["image", "photo"],
  zip: ["archive", "doc.zipper"], tar: ["archive", "doc.zipper"], gz: ["archive", "doc.zipper"],
  sh: ["shell", "terminal"], bash: ["shell", "terminal"], zsh: ["shell", "terminal"], fish: ["shell", "terminal"],
  sql: ["database", "cylinder"], lock: ["lock", "lock.doc"],
};

const BY_NAME = {
  dockerfile: ["box", "shippingbox"],
  makefile: ["build", "hammer"],
  license: ["seal", "checkmark.seal"],
  ".gitignore": ["ignore", "eye.slash"],
  ".gitattributes": ["settings", "gearshape"],
  ".env": ["settings", "gearshape"],
};

/** `[stroke glyph, SF Symbol]` for a file name, or null for an unknown type. */
export function file_type(name) {
  const lower = name.toLowerCase();
  if (lower in BY_NAME) return BY_NAME[lower];
  const dot = lower.lastIndexOf(".");
  if (dot > 0) return BY_EXT[lower.slice(dot + 1)] ?? null;
  return null;
}

/** SF Symbol for an editor tab showing `name`. */
export function tab_symbol(name) {
  return file_type(name)?.[1] ?? "doc.text";
}
