import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { basename } from "@/lib/files";

const MARKDOWN_EXT = new Set([".md", ".markdown", ".mdx"]);

export function is_markdown(path) {
  const name = basename(path).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot !== -1 && MARKDOWN_EXT.has(name.slice(dot));
}

export async function language_for(path) {
  const desc = LanguageDescription.matchFilename(languages, basename(path));
  if (!desc) return null;
  return desc.load();
}

export async function language_for_name(name) {
  const desc =
    LanguageDescription.matchLanguageName(languages, name, true) ??
    LanguageDescription.matchFilename(languages, `x.${name.toLowerCase()}`);
  if (!desc) return null;
  return desc.load();
}
