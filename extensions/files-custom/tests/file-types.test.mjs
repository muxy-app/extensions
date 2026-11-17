import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const opener = manifest.muxy.fileOpeners.find((item) => item.id === "editor");

function matches(patterns, path) {
  return patterns.some((pattern) => {
    const text = pattern.includes("/") ? path : path.split("/").at(-1);
    const expression = [...pattern].map((character) => {
      if (character === "*") return ".*";
      if (character === "?") return ".";
      return /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;
    }).join("");
    return new RegExp(`^${expression}$`, "i").test(text);
  });
}

test("automatic registrations cover supported files and leave unsupported binaries to Muxy", () => {
  for (const path of ["src/main.rs", "src/view.tsx", "module.cts", "docs/README.MD", "file.mdx", "Dockerfile", "nested/.env.local", "Makefile", "go.mod", "notes.txt", "image.png", "image.apng", "image.avif", "photo.jpeg", "document.pdf", "icon.svg", "index.html", "settings.toml", "code.zig"]) {
    assert.ok(matches(opener.fileTypes, path), path);
  }
  for (const path of ["archive.zip", "archive.tar.gz", "app.exe", "data.sqlite", "video.mp4", "font.woff2", "object.o", "program.bin", "future.custom", "notes.md/archive.zip"]) {
    assert.equal(matches(opener.fileTypes, path), false, path);
  }
  assert.ok(!opener.fileTypes.includes("*"));
});

test("older Muxy versions retain the existing opener and wildcard registration", () => {
  const { id, tabType, patterns, singleton } = opener;
  assert.deepEqual({ id, tabType, patterns, singleton }, {
    id: "editor", tabType: "code-editor", patterns: ["*"], singleton: false,
  });
  assert.ok(matches(patterns, "src/future.custom"));
});
