import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeHtml } from "../src/shared/sanitize.js";

test("keeps mandoc structure: sections, headings, code classes", () => {
  const input =
    '<main class="manual-text"><section class="Sh">' +
    '<h2 class="Sh" id="NAME"><a class="permalink" href="#NAME">NAME</a></h2>' +
    '<p class="Pp"><code class="Nm">open</code> — <span class="Nd">open files</span></p>' +
    "</section></main>";
  const out = sanitizeHtml(input);
  assert.match(out, /<main class="manual-text">/);
  assert.match(out, /<h2 class="Sh" id="s-NAME">/);
  assert.match(out, /<a class="permalink" href="#s-NAME">/);
  assert.match(out, /<code class="Nm">open<\/code>/);
});

test("drops script tags with their contents", () => {
  const out = sanitizeHtml('<p>ok</p><script>alert("xss")</script><p>after</p>');
  assert.equal(out, "<p>ok</p><p>after</p>");
});

test("drops style/iframe/svg with contents", () => {
  const out = sanitizeHtml("<style>p{color:red}</style><iframe src=x>inner</iframe><svg onload=x><circle/></svg>done");
  assert.equal(out, "done");
});

test("strips event handler and style attributes", () => {
  const out = sanitizeHtml('<p onclick="evil()" style="color:red" class="Pp">text</p>');
  assert.equal(out, '<p class="Pp">text</p>');
});

test("rejects javascript: and relative hrefs, keeps http(s) and #fragment", () => {
  assert.equal(sanitizeHtml('<a href="javascript:alert(1)">x</a>'), "<a>x</a>");
  assert.equal(sanitizeHtml('<a href="tar.1.html">x</a>'), "<a>x</a>");
  assert.equal(sanitizeHtml('<a href="https://example.com">x</a>'),
    '<a href="https://example.com">x</a>');
  assert.equal(sanitizeHtml('<a href="#SEE_ALSO">x</a>'), '<a href="#s-SEE_ALSO">x</a>');
});

test("unwraps unknown tags but keeps their text", () => {
  assert.equal(sanitizeHtml("<font color=red>hello</font> <custom-el>world</custom-el>"),
    "hello world");
});

test("comments and CDATA dropped, entities pass through", () => {
  assert.equal(sanitizeHtml("<!-- c --><p>&amp; &#x2014; &lt;tag&gt;</p>"),
    "<p>&amp; &#x2014; &lt;tag&gt;</p>");
});

test("attribute values with quotes cannot break out", () => {
  const out = sanitizeHtml('<span class=\'a" onmouseover="evil()\'>x</span>');
  assert.ok(!out.includes("onmouseover=\"evil"), out);
  assert.match(out, /^<span class="[^<]*">x<\/span>$/);
});

test("void elements emitted self-closed, no stray closers", () => {
  assert.equal(sanitizeHtml("a<br/>b<hr>c</br>"), "a<br/>b<hr/>c");
});
