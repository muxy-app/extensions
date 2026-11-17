import assert from "node:assert/strict";
import test from "node:test";
import { format_markdown } from "@/editor/viewers/markdown-format";

test("formats headings, lists, and tables consistently and is idempotent", async () => {
  const source = "#   Title   \n\n\n*   first\n* second\n\n|name|value|\n|-|-|\n|a|1|";
  const { formatted } = await format_markdown(source);
  assert.equal(formatted, "# Title\n\n- first\n- second\n\n| name | value |\n| ---- | ----- |\n| a    | 1     |\n");
  assert.equal((await format_markdown(formatted)).formatted, formatted);
});

test("wraps long paragraphs at 80 columns without changing words or losing the cursor", async () => {
  const source = "This Markdown paragraph contains enough words to run past the formatting width, so formatting should wrap it across lines without changing any of its text.";
  const result = await format_markdown(source, { cursorOffset: source.indexOf("changing") + "changing".length });
  const lines = result.formatted.trimEnd().split("\n");
  assert.ok(lines.length > 1);
  assert.ok(lines.every((line) => line.length <= 80));
  assert.equal(lines.join(" "), source);
  assert.equal(result.formatted.slice(result.cursorOffset - "changing".length, result.cursorOffset), "changing");
  assert.equal((await format_markdown(result.formatted)).formatted, result.formatted);
});

test("uses a custom line width to wrap paragraphs", async () => {
  const source = "Markdown formatting should use the selected line width so that readers can choose how many characters fit on each line of a paragraph.";
  const narrow = (await format_markdown(source, { printWidth: 40 })).formatted.trimEnd().split("\n");
  const wide = (await format_markdown(source, { printWidth: 120 })).formatted.trimEnd().split("\n");
  assert.ok(narrow.every((line) => line.length <= 40));
  assert.ok(wide.every((line) => line.length <= 120));
  assert.ok(narrow.length > wide.length);
  assert.equal(narrow.join(" "), source);
  assert.equal(wide.join(" "), source);
});

test("reflows soft breaks while preserving hard breaks, frontmatter, HTML, and code examples", async () => {
  const source = [
    "---", "title:   Example", "---", "", "#   Title", "",
    "First line", "second line  ", "third line", "",
    "```js", "const x={a:1};", "```", "",
    '<div data-x="a">raw</div>', "",
  ].join("\n");
  assert.equal((await format_markdown(source)).formatted, source.replace("#   Title", "# Title").replace("First line\nsecond line", "First line second line"));
});

test("keeps task states and blockquote contents", async () => {
  const source = "-   [ ] todo\n- [x] done\n\n> quote\n> text\n";
  assert.equal((await format_markdown(source)).formatted, "- [ ] todo\n- [x] done\n\n> quote text\n");
});

test("formats MDX without altering imports, JSX, or expressions", async () => {
  const source = 'import Thing from "./Thing"\n\n#   Title\n\n<Thing value={1+2} />\n';
  assert.equal((await format_markdown(source, { filePath: "docs/example.MDX" })).formatted, source.replace("#   Title", "# Title"));
});

test("maps the cursor to the same word after whitespace changes", async () => {
  const source = "#   Title\n\n*   first\n* second";
  const cursorOffset = source.indexOf("first") + "first".length;
  const result = await format_markdown(source, { cursorOffset });
  assert.equal(result.formatted.slice(result.cursorOffset - 5, result.cursorOffset), "first");
});

test("handles empty and whitespace-only documents", async () => {
  assert.equal((await format_markdown("")).formatted, "");
  assert.equal((await format_markdown(" \n\n")).formatted, "");
});
