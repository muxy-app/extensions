// The icon theme registry: built-in themes plus imported VS Code themes, the
// active choice, and lazy loading. Theme payloads are loaded on first use and
// cached per page; imports and removals bump a revision key so every page
// drops stale copies.

import { read_string, write_string, announce, watch_key } from "@/shared/prefs";
import { list_imported, get_imported, delete_themes } from "@/shared/icon-themes/store";
import { THEME_FORMAT } from "@/shared/icon-themes/compile";

const ACTIVE_KEY = "muxy.files.icon-theme";
const REVISION_KEY = "muxy.files.icon-themes.rev";

export const STROKE = "stroke";
export const MATERIAL = "material";

export const BUILTIN_THEMES = [
  { id: STROKE, label: "Minimal", detail: "Built-in · outline icons" },
  { id: MATERIAL, label: "Material Icon Theme", detail: "Built-in · colored file and folder icons" },
];

const valid_id = (id) => typeof id === "string" && (id === STROKE || id === MATERIAL || id.startsWith("vsix:"));

export function active_theme_id() {
  const id = read_string(ACTIVE_KEY);
  return valid_id(id) ? id : STROKE;
}

export function set_active_theme(id) {
  write_string(ACTIVE_KEY, valid_id(id) ? id : STROKE);
  announce(ACTIVE_KEY);
}

export function watch_active_theme(callback) {
  return watch_key(ACTIVE_KEY, () => callback(active_theme_id()));
}

export function bump_revision() {
  write_string(REVISION_KEY, String(Date.now()));
  announce(REVISION_KEY);
}

export function watch_revision(callback) {
  return watch_key(REVISION_KEY, () => {
    cache.clear();
    callback();
  });
}

/** Built-in and imported themes, for the menu. */
export async function list_themes() {
  let imported = [];
  let error = null;
  try {
    imported = (await list_imported()).filter((meta) => meta.format === THEME_FORMAT);
  } catch (err) {
    error = err;
  }
  return { builtin: BUILTIN_THEMES, imported, error };
}

const cache = new Map();
const fontLoads = new Map();

/** Registers a theme's glyph fonts with the page (font-based themes only). */
async function load_fonts(theme) {
  if (typeof FontFace !== "function" || !document?.fonts) return;
  await Promise.all(
    Object.values(theme.fonts ?? {}).map((font) => {
      if (!fontLoads.has(font.family)) {
        const face = new FontFace(font.family, `url(${font.uri})`, { weight: font.weight, style: font.style });
        fontLoads.set(
          font.family,
          face.load().then(
            (loaded) => document.fonts.add(loaded),
            () => undefined,
          ),
        );
      }
      return fontLoads.get(font.family);
    }),
  );
}

/** The compiled theme for `id`, or null for the stroke theme or a missing one. */
export function load_theme(id) {
  if (id === STROKE) return Promise.resolve(null);
  if (!cache.has(id)) {
    const promise = (async () => {
      const theme =
        id === MATERIAL ? (await import("@/shared/icon-themes/material.generated.json")).default : await get_imported(id);
      if (!theme || theme.format !== THEME_FORMAT) return null;
      await load_fonts(theme);
      return theme;
    })().catch((err) => {
      cache.delete(id);
      throw err;
    });
    cache.set(id, promise);
  }
  return cache.get(id);
}

export async function remove_themes(ids) {
  await delete_themes(ids);
  for (const id of ids) cache.delete(id);
  if (ids.includes(active_theme_id())) set_active_theme(STROKE);
  bump_revision();
}
