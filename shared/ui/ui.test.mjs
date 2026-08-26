import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const tokensCss = fs.readFileSync(path.join(dir, "tokens.css"), "utf8");
const uiCss = fs.readFileSync(path.join(dir, "ui.css"), "utf8");

const MUXY_VARIABLES = new Set([
  "background",
  "foreground",
  "foreground-muted",
  "surface",
  "border",
  "hover",
  "accent",
  "accent-soft",
  "diff-add",
  "diff-remove",
  "diff-hunk",
  "topbar-height",
]);

const PRIMITIVES = [
  ".mx-topbar",
  ".mx-topbar-title",
  ".mx-toolbar",
  ".mx-spacer",
  ".mx-btn",
  ".mx-btn-primary",
  ".mx-btn-ghost",
  ".mx-btn-danger",
  ".mx-icon-btn",
  ".mx-input",
  ".mx-select",
  ".mx-textarea",
  ".mx-card",
  ".mx-badge",
  ".mx-badge-accent",
  ".mx-spinner",
  ".mx-progress",
  ".mx-progress-bar",
  ".mx-switch",
  ".mx-segmented",
  ".mx-segmented-btn",
  ".mx-menu",
  ".mx-menu-item",
  ".mx-menu-separator",
  ".mx-list",
  ".mx-row",
  ".mx-section-label",
  ".mx-empty",
  ".mx-empty-title",
  ".mx-empty-copy",
  ".mx-divider",
  ".mx-kbd",
  ".mx-link",
  ".mx-md",
];

const TOKENS = [
  "--s1", "--s2", "--s3", "--s4", "--s5", "--s6", "--s7", "--s8", "--s9", "--s10",
  "--font-caption", "--font-footnote", "--font-body", "--font-emphasis", "--font-title", "--font-heading",
  "--icon-sm", "--icon", "--control", "--button-height", "--row-height",
  "--radius-badge", "--radius", "--radius-card", "--radius-sheet",
  "--font-ui", "--font-mono",
];

test("tokens.css defines the full documented scale", () => {
  for (const token of TOKENS) {
    assert.match(tokensCss, new RegExp(`${token}\\s*:`), `${token} is not defined`);
  }
});

test("ui.css defines every documented primitive", () => {
  for (const selector of PRIMITIVES) {
    const escaped = selector.replace(".", "\\.");
    assert.match(uiCss, new RegExp(`${escaped}[\\s,{:.\\[]`), `${selector} is missing`);
  }
});

test("no hardcoded hex colors", () => {
  for (const [name, css] of [["tokens.css", tokensCss], ["ui.css", uiCss]]) {
    const hexes = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    assert.deepEqual(hexes, [], `${name} contains hex color literals`);
  }
});

test("only official --muxy-* variables are referenced", () => {
  const used = new Set();
  for (const match of uiCss.matchAll(/var\(--muxy-([a-z-]+)/g)) used.add(match[1]);
  for (const name of used) {
    assert.ok(MUXY_VARIABLES.has(name), `--muxy-${name} is not an injected Muxy theme variable`);
  }
});

test("every non-muxy variable used in ui.css is defined in tokens.css", () => {
  for (const match of uiCss.matchAll(/var\((--[a-z0-9-]+)/g)) {
    const name = match[1];
    if (name.startsWith("--muxy-")) continue;
    assert.match(tokensCss, new RegExp(`${name}\\s*:`), `${name} is used but not defined in tokens.css`);
  }
});

test("escapeHtml escapes markup characters", async () => {
  const { escapeHtml } = await import("./index.js");
  assert.equal(escapeHtml(`<a href="x">&'</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  assert.equal(escapeHtml("plain"), "plain");
  assert.equal(escapeHtml(42), "42");
});

test("clamp bounds values", async () => {
  const { clamp } = await import("./index.js");
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(15, 0, 10), 10);
});

test("cls joins strings, arrays, and conditional objects", async () => {
  const { cls } = await import("./index.js");
  assert.equal(cls("a", null, undefined, false, "b"), "a b");
  assert.equal(cls("a", ["b", ["c"]]), "a b c");
  assert.equal(cls("mx-btn", { "is-active": true, hidden: false }), "mx-btn is-active");
  assert.equal(cls(), "");
});

test("middleTruncate keeps head and tail", async () => {
  const { middleTruncate } = await import("./index.js");
  assert.equal(middleTruncate("short", 10), "short");
  assert.equal(middleTruncate("abcdefghij", 5), "ab…ij");
  assert.equal(middleTruncate("abcdefghij", 6), "abc…ij");
  assert.equal(middleTruncate("abcdefghij", 1), "…");
  assert.equal(middleTruncate("exactly-ten", 11), "exactly-ten");
});

test("icon builds an svg with the documented stroke contract", async () => {
  const created = [];
  globalThis.document = {
    createElementNS(ns, tag) {
      const el = {
        ns,
        tag,
        attributes: {},
        children: [],
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
        appendChild(child) {
          this.children.push(child);
        },
      };
      created.push(el);
      return el;
    },
  };
  try {
    const { icon } = await import("./index.js");
    const svg = icon("M5 12h14", { size: 12, className: "mx-icon" });
    assert.equal(svg.tag, "svg");
    assert.equal(svg.ns, "http://www.w3.org/2000/svg");
    assert.equal(svg.attributes.viewBox, "0 0 24 24");
    assert.equal(svg.attributes.width, "12");
    assert.equal(svg.attributes.height, "12");
    assert.equal(svg.attributes.fill, "none");
    assert.equal(svg.attributes.stroke, "currentColor");
    assert.equal(svg.attributes["stroke-width"], "1.5");
    assert.equal(svg.attributes["stroke-linecap"], "round");
    assert.equal(svg.attributes["stroke-linejoin"], "round");
    assert.equal(svg.attributes["aria-hidden"], "true");
    assert.equal(svg.attributes.class, "mx-icon");
    assert.equal(svg.children.length, 1);
    assert.equal(svg.children[0].attributes.d, "M5 12h14");

    const multi = icon(["M1 1", "M2 2"]);
    assert.equal(multi.children.length, 2);
    assert.equal(multi.attributes.width, "14");
  } finally {
    delete globalThis.document;
  }
});
