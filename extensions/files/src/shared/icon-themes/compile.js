// Turns a VS Code extension that contributes file icon themes into compact,
// self-contained theme records: every icon the theme can show is inlined
// (SVG text, or a data URI for raster images and fonts), and every mapping is
// validated, lowercased, and pointed only at icons that actually loaded.
//
// It runs in the browser (importing a .vsix) and in Node (building the
// bundled Material theme), so it only touches its input through `source`:
//   { has(path), size(path), text(path), bytes(path) }
// with archive-relative, forward-slash paths.
//
// Format reference: https://code.visualstudio.com/api/extension-guides/file-icon-theme

import { parse as parse_jsonc, printParseErrorCode } from "jsonc-parser";
import { normalize_zip_path } from "@/shared/icon-themes/zip";

export const THEME_FORMAT = 1;

export const COMPILE_LIMITS = {
  maxThemesPerPack: 32,
  maxDefinitions: 20_000,
  maxIconBytes: 1024 * 1024,
  maxFontBytes: 4 * 1024 * 1024,
  maxThemeBytes: 64 * 1024 * 1024,
  maxMappingEntries: 100_000,
};

const IMAGE_TYPES = {
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
};
const FONT_TYPES = { woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf" };

const SINGLE_KEYS = ["file", "folder", "folderExpanded", "rootFolder", "rootFolderExpanded"];
const MAP_KEYS = [
  "fileExtensions",
  "fileNames",
  "folderNames",
  "folderNamesExpanded",
  "rootFolderNames",
  "rootFolderNamesExpanded",
  "languageIds",
];

export class ThemeError extends Error {}

const dirname = (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const join = (dir, rel) => normalize_zip_path(dir ? `${dir}/${rel}` : rel);
const ext_of = (path) => (path.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();

function to_base64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Parses JSON with comments and trailing commas, as VS Code does. */
export function parse_json(text, what) {
  const errors = [];
  const value = parse_jsonc(text.replace(/^﻿/, ""), errors, { allowTrailingComma: true, disallowComments: false });
  // Comments and trailing commas are allowed above; anything else is a broken file.
  if (errors.length > 0) {
    const first = errors[0];
    throw new ThemeError(`${what} isn’t valid JSON (${printParseErrorCode(first.error)} at offset ${first.offset}).`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ThemeError(`${what} isn’t a JSON object.`);
  return value;
}

/** Where the extension manifest lives: from the VSIX manifest, else the usual spots. */
async function find_package_json(source) {
  if (source.has("extension.vsixmanifest")) {
    const xml = await source.text("extension.vsixmanifest");
    for (const match of xml.matchAll(/<Asset\b[^>]*>/g)) {
      const tag = match[0];
      if (/Type\s*=\s*"Microsoft\.VisualStudio\.Code\.Manifest"/.test(tag)) {
        const path = tag.match(/Path\s*=\s*"([^"]+)"/)?.[1];
        const normalized = path && normalize_zip_path(path);
        if (normalized && source.has(normalized)) return normalized;
      }
    }
  }
  for (const candidate of ["extension/package.json", "package.json"]) if (source.has(candidate)) return candidate;
  return null;
}

async function load_nls(source, dir) {
  const path = join(dir, "package.nls.json");
  if (!path || !source.has(path)) return {};
  try {
    return parse_json(await source.text(path), "package.nls.json");
  } catch {
    return {};
  }
}

function localize(value, nls) {
  if (typeof value !== "string") return value;
  const key = value.match(/^%(.+)%$/)?.[1];
  if (!key) return value;
  const entry = nls[key];
  return typeof entry === "string" ? entry : typeof entry?.message === "string" ? entry.message : value;
}

function slug(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "theme";
}

function parse_font_character(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const escaped = value.match(/^\\(?:u\{?)?([0-9a-f]{1,6})\}?$/i);
  if (escaped) {
    const code = parseInt(escaped[1], 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : null;
  }
  return [...value].length <= 2 ? value : null;
}

/** Inspects the package and returns `{ pack, themes, errors }`; throws only when nothing is usable. */
export async function compile_package(source, { packageJsonPath = null, onProgress = null } = {}) {
  const pkgPath = packageJsonPath ?? (await find_package_json(source));
  if (!pkgPath) throw new ThemeError("This isn’t a VS Code extension: it has no package.json.");
  const pkg = parse_json(await source.text(pkgPath), "package.json");
  const root = dirname(pkgPath);
  const nls = await load_nls(source, root);

  const publisher = typeof pkg.publisher === "string" ? pkg.publisher : "unknown";
  const name = typeof pkg.name === "string" ? pkg.name : "extension";
  const pack = {
    id: slug(`${publisher}.${name}`),
    name,
    publisher,
    displayName: String(localize(pkg.displayName, nls) || name),
    version: typeof pkg.version === "string" ? pkg.version : "",
    license: typeof pkg.license === "string" ? pkg.license : "",
  };

  const contributes = pkg.contributes && typeof pkg.contributes === "object" ? pkg.contributes : {};
  const declared = Array.isArray(contributes.iconThemes) ? contributes.iconThemes : [];
  if (declared.length === 0) {
    const other = contributes.productIconThemes
      ? "it contributes a product icon theme (UI icons), not file icons"
      : contributes.themes
        ? "it contributes a color theme, not file icons"
        : "it contributes no file icon theme";
    throw new ThemeError(`“${pack.displayName}” can’t be used: ${other}.`);
  }
  if (declared.length > COMPILE_LIMITS.maxThemesPerPack) throw new ThemeError(`“${pack.displayName}” declares too many icon themes.`);

  const themes = [];
  const errors = [];
  for (const [index, entry] of declared.entries()) {
    const label = String(localize(entry?.label, nls) || entry?.id || `Theme ${index + 1}`);
    try {
      onProgress?.({ theme: label, index, count: declared.length });
      themes.push(await compile_theme(source, root, entry, label, pack));
    } catch (err) {
      errors.push({ theme: label, message: err instanceof Error ? err.message : String(err) });
    }
  }
  if (themes.length === 0) {
    throw new ThemeError(errors.map((e) => `${e.theme}: ${e.message}`).join("\n") || "No usable icon theme.");
  }
  return { pack, themes, errors };
}

async function compile_theme(source, root, entry, label, pack) {
  const themeId = slug(entry?.id ?? label);
  if (typeof entry?.path !== "string") throw new ThemeError("The theme has no path.");
  const themePath = join(root, entry.path);
  if (!themePath || !source.has(themePath)) throw new ThemeError(`Its definition file is missing (${entry.path}).`);
  const def = parse_json(await source.text(themePath), entry.path);
  const themeDir = dirname(themePath);

  const definitions = def.iconDefinitions;
  if (!definitions || typeof definitions !== "object" || Array.isArray(definitions)) {
    throw new ThemeError("It has no iconDefinitions.");
  }
  const defNames = Object.keys(definitions);
  if (defNames.length === 0) throw new ThemeError("Its iconDefinitions are empty.");
  if (defNames.length > COMPILE_LIMITS.maxDefinitions) throw new ThemeError("It defines too many icons.");

  const warnings = { missingFiles: 0, unsupported: 0, invalid: 0, brokenRefs: 0, oversized: 0, samples: [] };
  const note = (kind, detail) => {
    warnings[kind] += 1;
    if (warnings.samples.length < 12) warnings.samples.push(detail);
  };

  // Collect every icon a mapping points at, so unused definitions aren't stored.
  const layers = { dark: def, light: def.light && typeof def.light === "object" ? def.light : null };
  const wanted = new Set();
  for (const layer of Object.values(layers)) {
    if (!layer) continue;
    for (const key of SINGLE_KEYS) if (typeof layer[key] === "string") wanted.add(layer[key]);
    for (const key of MAP_KEYS) {
      const map = layer[key];
      if (map && typeof map === "object") for (const value of Object.values(map)) if (typeof value === "string") wanted.add(value);
    }
  }

  // Fonts (font-glyph themes such as Seti).
  const fonts = {};
  const fontList = Array.isArray(def.fonts) ? def.fonts : [];
  for (const font of fontList) {
    const id = typeof font?.id === "string" ? font.id : null;
    const src = Array.isArray(font?.src) ? font.src : [];
    if (!id) continue;
    for (const item of src) {
      const path = typeof item?.path === "string" ? join(themeDir, item.path) : null;
      const type = path && FONT_TYPES[ext_of(path)];
      if (!path || !type) continue;
      const resolved = source.has(path) ? path : source.has(safe_decode(path)) ? safe_decode(path) : null;
      if (!resolved) {
        note("missingFiles", `font ${item.path}`);
        continue;
      }
      if (source.size(resolved) > COMPILE_LIMITS.maxFontBytes) {
        note("oversized", `font ${item.path}`);
        continue;
      }
      fonts[id] = {
        family: `muxy-icons-${slug(pack.id)}-${slug(themeId)}-${slug(id)}`,
        uri: `data:${type};base64,${to_base64(await source.bytes(resolved))}`,
        weight: typeof font.weight === "string" ? font.weight : "normal",
        style: typeof font.style === "string" ? font.style : "normal",
        size: typeof font.size === "string" ? font.size : null,
      };
      break;
    }
  }
  const defaultFont = Object.keys(fonts)[0] ?? null;

  const icons = {};
  const fileCache = new Map();
  let totalBytes = 0;
  for (const name of wanted) {
    const icon = definitions[name];
    if (!icon || typeof icon !== "object") {
      note("brokenRefs", `“${name}” is mapped but not defined`);
      continue;
    }
    if (typeof icon.iconPath === "string" && icon.iconPath) {
      const path = join(themeDir, icon.iconPath);
      const resolved = path && (source.has(path) ? path : source.has(safe_decode(path)) ? safe_decode(path) : null);
      if (!resolved) {
        note("missingFiles", icon.iconPath);
        continue;
      }
      if (fileCache.has(resolved)) {
        if (fileCache.get(resolved)) icons[name] = fileCache.get(resolved);
        continue;
      }
      const ext = ext_of(resolved);
      const type = IMAGE_TYPES[ext];
      let compiled = null;
      if (!type) note("unsupported", `${icon.iconPath} (.${ext || "?"})`);
      else if (source.size(resolved) > COMPILE_LIMITS.maxIconBytes) note("oversized", icon.iconPath);
      else if (ext === "svg") {
        const svg = clean_svg(await source.text(resolved));
        if (svg) compiled = { svg };
        else note("invalid", `${icon.iconPath} isn’t an SVG image`);
      } else {
        const bytes = await source.bytes(resolved);
        if (looks_like_image(bytes, ext)) compiled = { uri: `data:${type};base64,${to_base64(bytes)}` };
        else note("invalid", `${icon.iconPath} isn’t a valid ${ext.toUpperCase()} image`);
      }
      fileCache.set(resolved, compiled);
      if (compiled) {
        icons[name] = compiled;
        totalBytes += (compiled.svg ?? compiled.uri).length;
        if (totalBytes > COMPILE_LIMITS.maxThemeBytes) throw new ThemeError("Its icons add up to more than 64 MB.");
      }
    } else if (icon.fontCharacter !== undefined) {
      const char = parse_font_character(icon.fontCharacter);
      const font = typeof icon.fontId === "string" ? icon.fontId : defaultFont;
      if (!char) note("invalid", `“${name}” has an unreadable fontCharacter`);
      else if (!font || !fonts[font]) note("missingFiles", `font for “${name}”`);
      else {
        icons[name] = {
          font,
          char,
          color: typeof icon.fontColor === "string" && /^#[0-9a-f]{3,8}$/i.test(icon.fontColor) ? icon.fontColor : null,
          size: typeof icon.fontSize === "string" ? icon.fontSize : null,
        };
      }
    } else note("invalid", `“${name}” has neither iconPath nor fontCharacter`);
  }

  const usable = (id) => typeof id === "string" && Object.hasOwn(icons, id);
  const compileLayer = (layer, isBase) => {
    if (!layer) return null;
    const out = {};
    let size = 0;
    for (const key of SINGLE_KEYS) if (usable(layer[key])) out[key] = layer[key];
    for (const key of MAP_KEYS) {
      const map = layer[key];
      if (!map || typeof map !== "object") continue;
      const target = {};
      for (const [rawKey, value] of Object.entries(map)) {
        if (typeof value !== "string") continue;
        if (!usable(value)) continue; // already reported when its icon failed to load
        let mapKey = key === "languageIds" ? rawKey : rawKey.toLowerCase();
        if (key === "fileExtensions") mapKey = mapKey.replace(/^\.+/, "");
        mapKey = mapKey.replace(/^\/+|\/+$/g, "");
        if (!mapKey) continue;
        target[mapKey] = value;
        size += 1;
      }
      if (Object.keys(target).length > 0) out[key] = target;
    }
    if (size > COMPILE_LIMITS.maxMappingEntries) throw new ThemeError("It has too many mappings.");
    return isBase || Object.keys(out).length > 0 ? out : null;
  };
  const dark = compileLayer(layers.dark, true);
  const light = compileLayer(layers.light, false);

  if (Object.keys(icons).length === 0) {
    throw new ThemeError(`None of its icons could be loaded${warnings.samples.length ? ` (e.g. ${warnings.samples[0]})` : ""}.`);
  }
  const mapped = (layer) => layer && (SINGLE_KEYS.some((k) => layer[k]) || MAP_KEYS.some((k) => layer[k]));
  if (!mapped(dark) && !mapped(light)) throw new ThemeError("None of its mappings point at a usable icon.");

  const count = (key) => Object.keys(dark[key] ?? {}).length;
  return {
    format: THEME_FORMAT,
    id: `vsix:${pack.id}/${themeId}`,
    themeId,
    label,
    pack,
    hidesExplorerArrows: def.hidesExplorerArrows === true,
    fonts,
    icons,
    dark,
    light,
    stats: {
      icons: Object.keys(icons).length,
      fileExtensions: count("fileExtensions"),
      fileNames: count("fileNames"),
      folderNames: count("folderNames"),
      languageIds: count("languageIds"),
      expandedFolders: Boolean(dark.folderExpanded || dark.folderNamesExpanded),
      lightVariant: Boolean(light),
      fontGlyphs: Object.keys(fonts).length > 0,
      bytes: totalBytes,
    },
    warnings,
  };
}

function safe_decode(path) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** Drops the XML prolog and doctype (they break nothing, but cost bytes) and checks it's an SVG. */
function clean_svg(text) {
  const svg = text
    .replace(/^﻿/, "")
    .replace(/<\?xml[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  return /^<svg[\s>]/i.test(svg) && /<\/svg>\s*$/i.test(svg) ? svg : null;
}

function looks_like_image(bytes, ext) {
  const b = bytes;
  if (b.length < 4) return false;
  switch (ext) {
    case "png":
      return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    case "jpg":
    case "jpeg":
      return b[0] === 0xff && b[1] === 0xd8;
    case "gif":
      return b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46;
    case "webp":
      return b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45;
    case "bmp":
      return b[0] === 0x42 && b[1] === 0x4d;
    case "ico":
      return b[0] === 0 && b[1] === 0 && (b[2] === 1 || b[2] === 2);
    default:
      return true;
  }
}
