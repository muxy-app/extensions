import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { basename, extname } from "@/lib/files";

const MARKDOWN_EXT = new Set([".md", ".markdown", ".mdx"]);

export function is_markdown(path) {
  return MARKDOWN_EXT.has(extname(path));
}

const IMAGE_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
  ".apng": "image/apng",
};

export function is_image(path) {
  return extname(path) in IMAGE_MIME;
}

export function image_mime(path) {
  return IMAGE_MIME[extname(path)] ?? "application/octet-stream";
}

export function is_svg(path) {
  return extname(path) === ".svg";
}

const RICH_LANGUAGES = {
  javascript: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  jsx: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true })),
  typescript: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true })),
  tsx: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true, jsx: true })),
  css: () => import("@codemirror/lang-css").then((m) => m.css()),
  html: () => import("@codemirror/lang-html").then((m) => m.html()),
  json: () => import("@codemirror/lang-json").then((m) => m.json()),
  python: () => import("@codemirror/lang-python").then((m) => m.python()),
  markdown: () => import("@codemirror/lang-markdown").then((m) => m.markdown({ codeLanguages: languages })),
  sql: () => import("@codemirror/lang-sql").then((m) => m.sql()),
  rust: () => import("@codemirror/lang-rust").then((m) => m.rust()),
  php: () => import("@codemirror/lang-php").then((m) => m.php()),
  xml: () => import("@codemirror/lang-xml").then((m) => m.xml()),
  vue: () => import("@codemirror/lang-vue").then((m) => m.vue()),
  java: () => import("@codemirror/lang-java").then((m) => m.java()),
  cpp: () => import("@codemirror/lang-cpp").then((m) => m.cpp()),
  go: () => import("@codemirror/lang-go").then((m) => m.go()),
  yaml: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
};

const RICH_BY_EXT = {
  ".js": "javascript",
  ".cjs": "javascript",
  ".mjs": "javascript",
  ".jsx": "jsx",
  ".ts": "typescript",
  ".cts": "typescript",
  ".mts": "typescript",
  ".tsx": "tsx",
  ".css": "css",
  ".html": "html",
  ".htm": "html",
  ".json": "json",
  ".jsonc": "json",
  ".json5": "json",
  ".webmanifest": "json",
  ".py": "python",
  ".pyw": "python",
  ".pyi": "python",
  ".md": "markdown",
  ".markdown": "markdown",
  ".mdx": "markdown",
  ".sql": "sql",
  ".rs": "rust",
  ".php": "php",
  ".xml": "xml",
  ".svg": "xml",
  ".vue": "vue",
  ".java": "java",
  ".c": "cpp",
  ".h": "cpp",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".go": "go",
  ".yaml": "yaml",
  ".yml": "yaml",
};

async function fallback_for_filename(name) {
  const desc = LanguageDescription.matchFilename(languages, name);
  return desc ? desc.load() : null;
}

export async function language_for(path) {
  const rich = RICH_LANGUAGES[RICH_BY_EXT[extname(path)]];
  if (rich) return rich();
  return fallback_for_filename(basename(path));
}

export async function language_for_name(name) {
  const key = name.toLowerCase();
  const rich = RICH_LANGUAGES[key] ?? RICH_LANGUAGES[RICH_BY_EXT[`.${key}`]];
  if (rich) return rich();
  const desc =
    LanguageDescription.matchLanguageName(languages, name, true) ??
    LanguageDescription.matchFilename(languages, `x.${key}`);
  return desc ? desc.load() : null;
}
