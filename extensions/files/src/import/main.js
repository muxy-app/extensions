// The "Import VS Code Icon Theme" modal. Muxy's web views can't open a native
// file chooser, but they do receive files dropped from Finder, so the .vsix is
// dropped here and read in the page: no shell commands or extra permissions.
// Everything is validated and previewed before anything is saved.

import "@/shared/base.css";
import "@/import/import.css";
import { h, icon_svg } from "@/shared/dom";
import { ZipArchive, ZipError } from "@/shared/icon-themes/zip";
import { compile_package, ThemeError } from "@/shared/icon-themes/compile";
import { IconResolver } from "@/shared/icon-themes/resolve";
import { save_pack, list_imported } from "@/shared/icon-themes/store";
import { bump_revision } from "@/shared/icon-themes/index";

const MAX_VSIX_BYTES = 150 * 1024 * 1024;
const DROP_GLYPH = [{ d: "M12 4v12" }, { d: "M7 11l5 5 5-5" }, { d: "M5 20h14" }];

const PREVIEW = [
  ["src/", true, false, "src"],
  ["build/", true, false, "build"],
  [".github/", true, true, ".github (open)"],
  ["node_modules/", true, false, "node_modules"],
  ["docs/", true, false, "docs"],
  ["misc/", true, false, "other folder"],
  ["index.ts", false],
  ["app.tsx", false],
  ["main.js", false],
  ["package.json", false],
  ["README.md", false],
  ["main.py", false],
  ["main.go", false],
  ["lib.rs", false],
  ["style.css", false],
  ["Dockerfile", false],
  [".gitignore", false],
  ["notes.unknown", false],
];

const root = document.getElementById("root");
const state = { busy: false, result: null, selected: null, fileName: "" };

function view(...children) {
  root.replaceChildren(h("div", { class: "importer" }, ...children));
}

function header() {
  return h("header", { class: "imp-header" }, h("div", { class: "imp-title" }, "Import Icon Theme"));
}

function footer(...buttons) {
  return h("footer", { class: "imp-footer" }, ...buttons);
}

function button(label, onClick, primary = false, disabled = false) {
  return h("button", { type: "button", class: primary ? "btn btn-primary" : "btn", onClick, disabled }, label);
}

const close = () => void muxy.modal.closeWebview();

// ---- Screens -----------------------------------------------------------------

function show_start(message = null) {
  state.result = null;
  view(
    header(),
    h(
      "div",
      { class: "drop-zone", id: "drop" },
      h("div", { class: "drop-icon" }, icon_svg(DROP_GLYPH, 14, 2)),
      h("div", { class: "drop-title" }, "Drop a .vsix here"),
    ),
    message && h("div", { class: "imp-error" }, message),
    footer(button("Cancel", close)),
  );
}

function show_busy(text) {
  view(header(), h("div", { class: "imp-busy" }, h("div", { class: "spinner" }), h("div", {}, text)), footer(button("Cancel", close)));
}

function preview_strip(theme, scheme) {
  const resolver = new IconResolver(theme, scheme);
  return h(
    "div",
    { class: `preview preview-${scheme}` },
    PREVIEW.map(([path, dir, open, label]) => {
      const icon = resolver.icon(path, dir, open);
      let glyph;
      if (icon?.svg || icon?.uri) {
        glyph = h("img", { src: icon.uri ?? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(icon.svg)}`, alt: "" });
      } else if (icon?.font) {
        glyph = h("span", { class: "glyph" }, icon.char);
        glyph.style.fontFamily = `"${theme.fonts[icon.font].family}"`;
        if (icon.color) glyph.style.color = icon.color;
      } else glyph = h("span", { class: "glyph missing" }, "–");
      return h("div", { class: "preview-cell", title: `${label ?? path} → ${icon?.id ?? "no icon (uses built-in)"}` }, glyph, h("span", {}, label ?? path));
    }),
  );
}

async function register_fonts(theme) {
  for (const font of Object.values(theme.fonts ?? {})) {
    try {
      const face = await new FontFace(font.family, `url(${font.uri})`).load();
      document.fonts.add(face);
    } catch {}
  }
}

function warnings_of(theme) {
  const w = theme.warnings;
  const parts = [];
  if (w.missingFiles) parts.push(`${w.missingFiles} missing file${w.missingFiles === 1 ? "" : "s"}`);
  if (w.unsupported) parts.push(`${w.unsupported} unsupported format${w.unsupported === 1 ? "" : "s"}`);
  if (w.invalid) parts.push(`${w.invalid} invalid icon${w.invalid === 1 ? "" : "s"}`);
  if (w.oversized) parts.push(`${w.oversized} too large`);
  if (w.brokenRefs) parts.push(`${w.brokenRefs} broken mapping${w.brokenRefs === 1 ? "" : "s"}`);
  return parts;
}

function show_report({ pack, themes, errors }, existing) {
  state.selected ??= themes[0].id;
  const scheme = muxy.theme?.colorScheme === "light" ? "light" : "dark";
  const replaced = existing.filter((m) => m.pack.id === pack.id);

  const cards = themes.map((theme) => {
    const s = theme.stats;
    const facts = [
      `${s.icons} icons`,
      `${s.fileExtensions} extensions`,
      `${s.fileNames} file names`,
      s.folderNames ? `${s.folderNames} folder names` : "no per-folder icons",
      s.languageIds ? `${s.languageIds} languages` : null,
      s.expandedFolders ? "open-folder icons" : null,
      s.lightVariant ? "light-mode variant" : null,
      s.fontGlyphs ? "font glyphs" : null,
    ].filter(Boolean);
    const warns = warnings_of(theme);
    return h(
      "label",
      { class: `theme-card${state.selected === theme.id ? " selected" : ""}` },
      h("input", {
        type: "radio",
        name: "theme",
        value: theme.id,
        checked: state.selected === theme.id,
        onChange: () => {
          state.selected = theme.id;
          show_report(state.result, existing);
        },
      }),
      h(
        "div",
        { class: "theme-body" },
        h("div", { class: "theme-name" }, theme.label, h("span", { class: "ok" }, "✓ valid")),
        h("div", { class: "theme-facts" }, facts.join(" · ")),
        warns.length > 0 &&
          h(
            "details",
            { class: "theme-warn" },
            h("summary", {}, `Skipped: ${warns.join(", ")}`),
            h("ul", {}, theme.warnings.samples.map((sample) => h("li", {}, sample))),
          ),
        preview_strip(theme, scheme),
      ),
    );
  });

  view(
    header(),
    h(
      "div",
      { class: "pack" },
      h("div", { class: "pack-name" }, `${pack.displayName}${pack.version ? ` ${pack.version}` : ""}`),
      h(
        "div",
        { class: "pack-meta" },
        [`${pack.publisher}`, pack.license && `license ${pack.license}`, state.fileName].filter(Boolean).join(" · "),
      ),
      replaced.length > 0 &&
        h(
          "div",
          { class: "imp-note" },
          `Replaces the installed ${pack.displayName}${replaced[0].pack.version ? ` ${replaced[0].pack.version}` : ""}.`,
        ),
    ),
    h("div", { class: "imp-section-title" }, themes.length === 1 ? "Theme" : `${themes.length} themes — choose the one to use now`),
    h("div", { class: "theme-list" }, cards),
    errors.length > 0 &&
      h(
        "div",
        { class: "imp-error" },
        h("div", {}, `${errors.length} theme${errors.length === 1 ? "" : "s"} can’t be used and will be skipped:`),
        h("ul", {}, errors.map((e) => h("li", {}, `${e.theme}: ${e.message}`))),
      ),
    footer(
      button("Choose Another…", () => show_start()),
      button("Cancel", close),
      button(themes.length === 1 ? "Install and Use" : `Install ${themes.length} and Use Selected`, () => void install(), true),
    ),
  );
}

// ---- Actions -------------------------------------------------------------------

async function install() {
  const { pack, themes } = state.result;
  show_busy("Saving…");
  try {
    await save_pack(pack.id, themes);
    bump_revision();
    await muxy.modal.submitWebview({ installed: themes.map((t) => t.id), select: state.selected });
  } catch (err) {
    show_start(`Couldn’t save the theme: ${message_of(err)}`);
  }
}

async function analyze(bytes, fileName) {
  state.fileName = fileName;
  state.selected = null;
  if (bytes.byteLength > MAX_VSIX_BYTES) throw new ThemeError(`The file is larger than ${format_bytes(MAX_VSIX_BYTES)}.`);
  show_busy(`Validating ${fileName}…`);
  const zip = new ZipArchive(bytes);
  const source = {
    has: (path) => zip.has(path),
    size: (path) => zip.sizeOf(path),
    text: (path) => zip.textOf(path),
    bytes: (path) => zip.bytesOf(path),
  };
  const result = await compile_package(source, {
    onProgress: ({ theme, index, count }) => show_busy(`Validating ${theme} (${index + 1} of ${count})…`),
  });
  for (const theme of result.themes) await register_fonts(theme);
  const existing = await list_imported().catch(() => []);
  state.result = result;
  show_report(result, existing);
}

async function run(task) {
  if (state.busy) return;
  state.busy = true;
  try {
    await task();
  } catch (err) {
    show_start(message_of(err));
  } finally {
    state.busy = false;
  }
}

function on_drop(event) {
  event.preventDefault();
  document.body.classList.remove("dragging");
  const file = event.dataTransfer?.files?.[0];
  if (!file) {
    show_start("That wasn’t a file. Drag the .vsix itself from Finder.");
    return;
  }
  void run(async () => {
    if (file.size > MAX_VSIX_BYTES) throw new ThemeError(`The file is larger than ${format_bytes(MAX_VSIX_BYTES)}.`);
    show_busy(`Reading ${file.name}…`);
    await analyze(new Uint8Array(await file.arrayBuffer()), file.name);
  });
}

// ---- Helpers ---------------------------------------------------------------------

function message_of(err) {
  if (err instanceof ZipError || err instanceof ThemeError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err ?? "Unknown error");
}

function format_bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// The whole window accepts drops; without this WebKit would navigate to the file.
document.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (!state.busy && !state.result) document.body.classList.add("dragging");
});
document.addEventListener("dragleave", (event) => {
  if (!event.relatedTarget) document.body.classList.remove("dragging");
});
document.addEventListener("drop", (event) => {
  if (state.busy) {
    event.preventDefault();
    return;
  }
  on_drop(event);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !state.busy) close();
});

show_start();
