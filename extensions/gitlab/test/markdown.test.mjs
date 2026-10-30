import test from "node:test";
import assert from "node:assert/strict";

import { renderMarkdown } from "../src/markdown.js";
import { splitList, timeAgo } from "../src/util.js";

test("renderMarkdown escapes HTML in the source", () => {
  const html = renderMarkdown("<img src=x onerror=alert(1)>");
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;img"));
});

test("renderMarkdown keeps script-ish link targets out of href", () => {
  const html = renderMarkdown("[click](javascript:alert(1))");
  assert.ok(!html.includes("href"));
});

test("renderMarkdown renders headings, lists and code fences", () => {
  const html = renderMarkdown("# Title\n\n- one\n- two\n\n```js\ncode();\n```");
  assert.ok(html.includes('class="md-h md-h1"'));
  assert.ok(html.includes("<ul"));
  assert.ok(html.includes("<li>one</li>"));
  assert.ok(html.includes("code();"));
  assert.ok(!html.includes("js\ncode"));
});

test("renderMarkdown renders GitLab task lists as checkboxes", () => {
  const html = renderMarkdown("- [x] done\n- [ ] todo");
  assert.ok(html.includes('<input type="checkbox" disabled checked>'));
  assert.ok(html.includes('<input type="checkbox" disabled>'));
});

test("renderMarkdown falls back to a placeholder for an empty description", () => {
  assert.ok(renderMarkdown("").includes("No description"));
  assert.ok(renderMarkdown("   ").includes("No description"));
});

test("splitList trims and drops empties", () => {
  assert.deepEqual(splitList(" bug , ux ,, "), ["bug", "ux"]);
  assert.deepEqual(splitList(""), []);
});

test("timeAgo returns an empty string for an unparsable date", () => {
  assert.equal(timeAgo("not-a-date"), "");
  assert.match(timeAgo(new Date(Date.now() - 5000).toISOString()), /^\d+s ago$/);
});
