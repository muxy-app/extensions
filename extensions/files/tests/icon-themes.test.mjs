import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { ZipArchive, ZipError } from "@/shared/icon-themes/zip";
import { compile_package, ThemeError } from "@/shared/icon-themes/compile";
import { IconResolver } from "@/shared/icon-themes/resolve";

// ---- A minimal ZIP writer, so tests can build odd packages -----------------------

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function make_zip(files, { store = false } = {}) {
  const enc = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const raw = typeof content === "string" ? enc.encode(content) : content;
    const data = store ? raw : await deflate(raw);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x800, true);
    local.setUint16(8, store ? 0 : 8, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, nameBytes.length, true);
    locals.push(new Uint8Array(local.buffer), nameBytes, data);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x800, true);
    central.setUint16(10, store ? 0 : 8, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, raw.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint32(42, offset, true);
    centrals.push(new Uint8Array(central.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cdSize = centrals.reduce((n, part) => n + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Uint8Array(await new Blob([...locals, ...centrals, new Uint8Array(end.buffer)]).arrayBuffer());
}

const source_of = (zip) => ({
  has: (p) => zip.has(p),
  size: (p) => zip.sizeOf(p),
  text: (p) => zip.textOf(p),
  bytes: (p) => zip.bytesOf(p),
});

const SVG = (color) => `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect fill="${color}" width="16" height="16"/></svg>`;

async function compile(files, opts) {
  return compile_package(source_of(new ZipArchive(await make_zip(files, opts))));
}

// ---- ZIP -----------------------------------------------------------------------------

test("zip: reads stored and deflated entries", async () => {
  for (const store of [true, false]) {
    const zip = new ZipArchive(await make_zip({ "a/b.txt": "hello", "c.txt": "x".repeat(5000) }, { store }));
    assert.equal(await zip.textOf("a/b.txt"), "hello");
    assert.equal((await zip.textOf("c.txt")).length, 5000);
    assert.equal(zip.resolve("A/B.TXT"), "a/b.txt", "falls back to case-insensitive lookup");
    assert.equal(zip.resolve("a/./x/../b.txt"), "a/b.txt");
  }
});

test("zip: rejects non-zip and truncated data", async () => {
  assert.throws(() => new ZipArchive(new TextEncoder().encode("definitely not a zip file at all")), ZipError);
  const good = await make_zip({ "x.txt": "abc" });
  assert.throws(() => new ZipArchive(good.slice(0, good.length - 30)), ZipError);
});

// ---- Compiler --------------------------------------------------------------------------

const PKG = (extra = {}) =>
  JSON.stringify({
    name: "demo-icons",
    publisher: "Someone",
    version: "1.2.3",
    displayName: "%name%",
    contributes: { iconThemes: [{ id: "demo", label: "%label%", path: "./themes/demo.json" }] },
    ...extra,
  });

test("compile: JSONC, nls labels, relative ../ paths, case-mismatched files, light layer", async () => {
  const { pack, themes, errors } = await compile({
    "extension.vsixmanifest": '<Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" /></Assets>',
    "extension/package.json": PKG(),
    "extension/package.nls.json": JSON.stringify({ name: "Demo Icons", label: { message: "Demo Dark" } }),
    "extension/themes/demo.json": `{
      // comments and trailing commas are allowed
      "iconDefinitions": {
        "file": { "iconPath": "../icons/File.svg" },
        "folder": { "iconPath": "../icons/folder.svg" },
        "folder-open": { "iconPath": "../icons/folder-open.svg" },
        "folder-build": { "iconPath": "../icons/build.svg" },
        "ts": { "iconPath": "../icons/ts.svg" },
        "dts": { "iconPath": "../icons/dts.svg" },
        "png-icon": { "iconPath": "../icons/p.png" },
        "light-ts": { "iconPath": "../icons/ts-light.svg" },
        "missing": { "iconPath": "../icons/nope.svg" },
      },
      "file": "file",
      "folder": "folder",
      "folderExpanded": "folder-open",
      "folderNames": { "Build": "folder-build", "github/workflows": "folder-build" },
      "fileExtensions": { "ts": "ts", ".d.ts": "dts", "png": "png-icon", "x": "missing", "y": "undefined-def" },
      "fileNames": { "README.md": "ts" },
      "light": { "fileExtensions": { "ts": "light-ts" } },
    }`,
    "extension/icons/file.svg": SVG("#111"),
    "extension/icons/folder.svg": SVG("#222"),
    "extension/icons/folder-open.svg": SVG("#333"),
    "extension/icons/build.svg": SVG("#444"),
    "extension/icons/ts.svg": SVG("#555"),
    "extension/icons/dts.svg": SVG("#666"),
    "extension/icons/ts-light.svg": SVG("#777"),
    "extension/icons/p.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  });
  assert.deepEqual(errors, []);
  assert.equal(pack.displayName, "Demo Icons");
  assert.equal(pack.id, "someone.demo-icons");
  const [theme] = themes;
  assert.equal(theme.label, "Demo Dark");
  assert.equal(theme.id, "vsix:someone.demo-icons/demo");
  assert.ok(theme.icons.file.svg.startsWith("<svg"), "xml prolog stripped; File.svg found via case fallback");
  assert.ok(theme.icons["png-icon"].uri.startsWith("data:image/png;base64,"));
  assert.equal(theme.warnings.missingFiles, 1);
  assert.equal(theme.warnings.brokenRefs, 1);
  assert.equal(theme.dark.fileExtensions.x, undefined, "mappings to unloadable icons are dropped");

  const dark = new IconResolver(theme, "dark");
  assert.equal(dark.iconId("src/a.ts", false), "ts");
  assert.equal(dark.iconId("src/a.d.ts", false), "dts", "longest extension wins");
  assert.equal(dark.iconId("readme.md", false), "ts", "file names are case-insensitive");
  assert.equal(dark.iconId("whatever.zzz", false), "file");
  assert.equal(dark.iconId("build/", true, false), "folder-build");
  assert.equal(dark.iconId("build/", true, true), "folder-build", "folderNames apply to open folders too");
  assert.equal(dark.iconId("misc/", true, false), "folder");
  assert.equal(dark.iconId("misc/", true, true), "folder-open");
  assert.equal(dark.iconId("repo/github/workflows/", true, false), "folder-build", "path-qualified folder names");
  assert.equal(dark.iconId(".github/workflows/", true, false), "folder", "segments must match exactly");
  assert.equal(dark.iconId("workflows/", true, false), "folder", "...only under that parent");
  const light = new IconResolver(theme, "light");
  assert.equal(light.iconId("a.ts", false), "light-ts");
  assert.equal(light.iconId("a.d.ts", false), "dts", "light falls back to the base layer");
});

test("compile: languageIds are used when extensions miss", async () => {
  const { themes } = await compile({
    "extension/package.json": PKG(),
    "extension/themes/demo.json": JSON.stringify({
      iconDefinitions: { f: { iconPath: "f.svg" }, py: { iconPath: "py.svg" } },
      file: "f",
      languageIds: { python: "py" },
    }),
    "extension/themes/f.svg": SVG("#000"),
    "extension/themes/py.svg": SVG("#00f"),
  });
  const r = new IconResolver(themes[0]);
  assert.equal(r.iconId("main.py", false), "py");
  assert.equal(r.iconId("anything/", true), null, "no folder icon: caller uses its built-in glyph");
});

test("compile: font-glyph themes", async () => {
  const woff = new Uint8Array([0x77, 0x4f, 0x46, 0x46, 0, 0, 0, 0]);
  const { themes } = await compile({
    "extension/package.json": PKG(),
    "extension/themes/demo.json": JSON.stringify({
      fonts: [{ id: "seti", src: [{ path: "./seti.woff", format: "woff" }] }],
      iconDefinitions: { f: { fontCharacter: "\\E001", fontColor: "#519aba" } },
      file: "f",
    }),
    "extension/themes/seti.woff": woff,
  });
  const icon = new IconResolver(themes[0]).icon("x.txt", false);
  assert.equal(icon.char, "");
  assert.equal(icon.color, "#519aba");
  assert.ok(themes[0].fonts[icon.font].uri.startsWith("data:font/woff;base64,"));
});

test("compile: clear errors for packages that aren't file icon themes", async () => {
  await assert.rejects(
    compile({ "extension/package.json": PKG({ contributes: { themes: [{ path: "x.json" }] } }) }),
    (err) => err instanceof ThemeError && /color theme/.test(err.message),
  );
  await assert.rejects(
    compile({ "extension/package.json": PKG({ contributes: { productIconThemes: [{ path: "x.json" }] } }) }),
    (err) => err instanceof ThemeError && /product icon theme/.test(err.message),
  );
  await assert.rejects(compile({ "readme.txt": "hi" }), (err) => err instanceof ThemeError && /no package\.json/.test(err.message));
  await assert.rejects(
    compile({ "extension/package.json": PKG(), "extension/themes/demo.json": '{"iconDefinitions": {"f": {"iconPath": "gone.svg"}}, "file": "f"}' }),
    (err) => err instanceof ThemeError && /None of its icons/.test(err.message),
  );
  await assert.rejects(
    compile({ "extension/package.json": PKG(), "extension/themes/demo.json": "{ not json" }),
    (err) => err instanceof ThemeError && /valid JSON|JSON object|None/.test(err.message),
  );
});

test("compile: a broken theme is reported while the others in the pack install", async () => {
  const { themes, errors } = await compile({
    "extension/package.json": PKG({
      contributes: {
        iconThemes: [
          { id: "good", label: "Good", path: "good.json" },
          { id: "bad", label: "Bad", path: "missing.json" },
        ],
      },
    }),
    "extension/good.json": JSON.stringify({ iconDefinitions: { f: { iconPath: "f.svg" } }, file: "f" }),
    "extension/f.svg": SVG("#000"),
  });
  assert.equal(themes.length, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /missing/);
});

test("compile: rejects SVG files that aren't SVG", async () => {
  const { themes } = await compile({
    "extension/package.json": PKG(),
    "extension/themes/demo.json": JSON.stringify({
      iconDefinitions: { f: { iconPath: "f.svg" }, bad: { iconPath: "bad.svg" } },
      file: "f",
      fileExtensions: { txt: "bad" },
    }),
    "extension/themes/f.svg": SVG("#000"),
    "extension/themes/bad.svg": "<html>nope</html>",
  });
  assert.equal(themes[0].warnings.invalid, 1);
  assert.equal(new IconResolver(themes[0]).iconId("a.txt", false), "f");
});

// ---- Real packages (optional: set ICON_VSIX_DIR to a folder of .vsix files) ------------

const REAL = process.env.ICON_VSIX_DIR;
const REAL_FILES = [
  "PKief.material-icon-theme-5.40.0.vsix",
  "thang-nm.flow-icons-2.0.10.vsix",
  "ardonplay.vscode-jetbrains-icon-theme-0.0.4.vsix",
];
for (const file of REAL_FILES) {
  const path = REAL && `${REAL}/${file}`;
  test(`real package: ${file}`, { skip: !path || !existsSync(path) }, async () => {
    const { themes, errors } = await compile_package(source_of(new ZipArchive(readFileSync(path))));
    assert.deepEqual(errors, []);
    assert.ok(themes.length >= 1);
    for (const theme of themes) {
      const r = new IconResolver(theme);
      assert.ok(r.iconId("index.ts", false), `${theme.label}: .ts has an icon`);
      assert.ok(r.iconId("src/", true), `${theme.label}: folders have an icon`);
      assert.equal(theme.warnings.missingFiles, 0);
    }
  });
}
