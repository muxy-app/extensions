import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collect_html_block,
  extract_inline_html,
  html_block_start,
  leading_closes,
  restore_inline_html,
  safe_href,
  unclosed_containers,
} from "@/editor/viewers/markdown-html";
import { escape_html } from "@/shared/dom";

// The same steps as the preview: hold the HTML aside, escape the rest, put it back.
const inline = (text) => {
  const { text: out, markup } = extract_inline_html(text);
  return restore_inline_html(escape_html(out), markup);
};

test("block-level tags start an HTML block; inline ones don't", () => {
  assert.deepEqual(html_block_start('<p align="center">'), { end: "blank" });
  assert.deepEqual(html_block_start("</div>"), { end: "blank" });
  assert.deepEqual(html_block_start("<details open>"), { end: "blank" });
  assert.deepEqual(html_block_start("<!-- note -->"), { end: "comment" });
  assert.deepEqual(html_block_start("<pre>"), { end: "raw", tag: "pre" });
  assert.equal(html_block_start("<a href='x'>link</a>"), null);
  assert.equal(html_block_start("<img src=a.png>"), null);
  assert.equal(html_block_start("    <div>"), null);
  assert.equal(html_block_start("<divider>"), null);
  assert.equal(html_block_start("plain text"), null);
});

test("an HTML block runs to the blank line; comments and <pre> to their end", () => {
  const lines = ['<p align="center">', '  <img src="logo.png">', "</p>", "", "after"];
  assert.deepEqual(collect_html_block(lines, 0), { html: lines.slice(0, 3).join("\n"), next: 3 });
  const comment = ["<!--", "", "hidden", "-->", "shown"];
  assert.equal(collect_html_block(comment, 0).next, 4);
  const pre = ["<pre>", "a", "", "b</pre>", "c"];
  assert.equal(collect_html_block(pre, 0).html, "<pre>\na\n\nb</pre>");
});

test("tracks wrappers left open for the markdown that follows", () => {
  assert.deepEqual(unclosed_containers('<div align="center">'), ["div"]);
  assert.deepEqual(unclosed_containers("<details><summary>More</summary>"), ["details"]);
  assert.deepEqual(unclosed_containers('<div align="center"><div>x</div>'), ["div"]);
  assert.deepEqual(unclosed_containers("<div><p>closed</p></div>"), []);
  assert.deepEqual(unclosed_containers("<p>not a wrapper"), []);
  assert.deepEqual(leading_closes("</details>\n<details><summary>Two</summary>"), {
    closes: ["details"],
    rest: "\n<details><summary>Two</summary>",
  });
});

test("allowed inline tags pass through with safe attributes only", () => {
  assert.equal(inline("Press <kbd>Cmd</kbd>+<kbd>P</kbd>"), "Press <kbd>Cmd</kbd>+<kbd>P</kbd>");
  assert.equal(
    inline('<a href="#install" onclick="x()" style="color:red">Mac</a>'),
    '<a href="#install">Mac</a>',
  );
  assert.equal(inline('<a href="javascript:alert(1)">x</a>'), '<a href="#">x</a>');
  assert.equal(inline('<a href=" java\tscript:alert(1)">x</a>'), '<a href="#">x</a>');
  assert.equal(inline("line<br/>break"), "line<br>break");
});

test("other tags and comments are not rendered as HTML", () => {
  assert.equal(inline("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(inline("<iframe src=x>"), "&lt;iframe src=x&gt;");
  assert.equal(inline("before <!-- hidden --> after"), "before  after");
  assert.equal(inline("1 < 2 and 3 > 2"), "1 &lt; 2 and 3 &gt; 2");
});

test("autolinks and inline images", () => {
  assert.equal(inline("<https://muxy.app>"), '<a href="https://muxy.app">https://muxy.app</a>');
  assert.equal(
    inline('<a href="https://x.test"><img src="badge.svg" alt="CI"></a>'),
    '<a href="https://x.test"><img class="md-img" data-src="badge.svg" alt="CI"></a>',
  );
});

test("safe_href blocks script-like schemes", () => {
  assert.equal(safe_href("https://x.test"), "https://x.test");
  assert.equal(safe_href("docs/a.md#b"), "docs/a.md#b");
  assert.equal(safe_href("JavaScript:x"), "#");
  assert.equal(safe_href("data:text/html,x"), "#");
});
