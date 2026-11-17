import { test } from "node:test";
import assert from "node:assert/strict";

// The source rewriting behind the preview's checkboxes lives in a DOM-free
// module, so it can be tested directly.
const { toggle_task_in_source } = await import("@/editor/viewers/markdown-tasks");

test("toggles tasks in document order, nested ones included", () => {
  const source = ["- [ ] one", "- [x] two", "  - [ ] nested", "1. [ ] ordered"].join("\n");
  assert.equal(toggle_task_in_source(source, 2, true), source.replace("  - [ ] nested", "  - [x] nested"));
  assert.equal(toggle_task_in_source(source, 1, false), source.replace("- [x] two", "- [ ] two"));
  assert.equal(toggle_task_in_source(source, 3, true), source.replace("1. [ ] ordered", "1. [x] ordered"));
});

test("accepts + bullets and 1) numbering like the renderer", () => {
  assert.equal(toggle_task_in_source("+ [ ] plus", 0, true), "+ [x] plus");
  assert.equal(toggle_task_in_source("2) [ ] paren", 0, true), "2) [x] paren");
});

test("skips task-like lines inside fenced code", () => {
  const source = ["```md", "- [ ] not a task", "```", "- [ ] real"].join("\n");
  assert.equal(toggle_task_in_source(source, 0, true), source.replace("- [ ] real", "- [x] real"));
  assert.equal(toggle_task_in_source(source, 1, true), null);
});

test("counts tasks inside blockquotes", () => {
  const source = ["> - [ ] quoted", "- [ ] after"].join("\n");
  assert.equal(toggle_task_in_source(source, 0, true), "> - [x] quoted\n- [ ] after");
  assert.equal(toggle_task_in_source(source, 1, true), "> - [ ] quoted\n- [x] after");
});

test("keeps CRLF line endings", () => {
  assert.equal(toggle_task_in_source("- [ ] a\r\n- [ ] b", 1, true), "- [ ] a\r\n- [x] b");
});
