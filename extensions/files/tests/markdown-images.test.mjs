import { test } from "node:test";
import assert from "node:assert/strict";
import { extract_images, image_markup, image_source, restore_images } from "@/editor/viewers/markdown-images";

test("markdown images become placeholders that survive escaping", () => {
  const { text, images } = extract_images('See ![The *logo*](img/logo.png "Logo") here');
  assert.doesNotMatch(text, /!\[/);
  assert.deepEqual(images, [{ src: "img/logo.png", alt: "The *logo*", title: "Logo" }]);
  const html = restore_images(text.replace("See", "<b>See</b>"), images);
  assert.equal(
    html,
    '<b>See</b> <img class="md-img" data-src="img/logo.png" alt="The *logo*" title="Logo"> here',
  );
});

test("angle-bracket paths keep their spaces", () => {
  const { images } = extract_images("![shot](<docs/my shot.png>)");
  assert.equal(images[0].src, "docs/my shot.png");
});

test("a linked image keeps the link around the placeholder", () => {
  const { text, images } = extract_images("[![CI](https://x.test/badge.svg)](https://x.test)");
  assert.match(text, /^\[\u00000\u0000\]\(https:\/\/x\.test\)$/);
  assert.equal(images[0].src, "https://x.test/badge.svg");
});

test("raw <img> tags keep src, alt and sizes, and drop everything else", () => {
  const { images } = extract_images(`<img src="logo.png" alt='Logo' width="120" onerror="alert(1)" />`);
  assert.deepEqual(images, [{ src: "logo.png", alt: "Logo", title: "", width: "120", height: undefined }]);
  assert.equal(
    image_markup(images[0]),
    '<img class="md-img" data-src="logo.png" alt="Logo" width="120">',
  );
  assert.equal(image_markup({ src: "a.png", alt: "", width: "50%", height: "10em" }), '<img class="md-img" data-src="a.png" alt="" style="width: 50%">');
});

test("attribute values are escaped in markup", () => {
  assert.equal(
    image_markup({ src: 'a.png" onload="x', alt: "<b>" }),
    '<img class="md-img" data-src="a.png&quot; onload=&quot;x" alt="&lt;b&gt;">',
  );
});

test("an <img> without src is left as text", () => {
  assert.deepEqual(extract_images("<img alt=x>").images, []);
});

test("image sources resolve against the markdown file", () => {
  assert.deepEqual(image_source("img/a.png", "docs/guide.md"), { kind: "file", path: "docs/img/a.png" });
  assert.deepEqual(image_source("../a.png?raw=1#x", "docs/guide.md"), { kind: "file", path: "a.png" });
  assert.deepEqual(image_source("/assets/a%20b.png", "docs/guide.md"), { kind: "file", path: "assets/a b.png" });
  assert.equal(image_source("../../escape.png", "docs/guide.md"), null);
});

test("web images are marked remote; data images load directly; other schemes are refused", () => {
  assert.deepEqual(image_source("https://x.test/a.png", "a.md"), { kind: "remote", url: "https://x.test/a.png", host: "x.test" });
  assert.deepEqual(image_source("//x.test:8080/a.png", "a.md"), { kind: "remote", url: "https://x.test:8080/a.png", host: "x.test:8080" });
  assert.equal(image_source("https://", "a.md"), null);
  assert.equal(image_source("data:image/png;base64,AAAA", "a.md").kind, "url");
  assert.equal(image_source("javascript:alert(1)", "a.md"), null);
  assert.equal(image_source("file:///etc/passwd", "a.md"), null);
  assert.equal(image_source("", "a.md"), null);
});
