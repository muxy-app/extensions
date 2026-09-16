import test from "node:test";
import assert from "node:assert/strict";
import { refToId, refFromId, refTitle, validName, validSection } from "../src/shared/refs.js";

test("round-trips plain tldr and sectioned man refs", () => {
  for (const ref of [
    { source: "tldr", name: "tar" },
    { source: "tldr", name: "git-commit" },
    { source: "tldr", name: "compress-archive", platform: "windows" },
    { source: "man", name: "open", section: "2" },
    { source: "man", name: "zshall", section: "1" },
  ]) {
    assert.deepEqual(refFromId(refToId(ref)), ref);
  }
});

test("round-trips hostile names (colons, parens, punctuation)", () => {
  for (const name of ["!", "$", "((", ",", ":", "::", "a:b:c", "open(2)"]) {
    const ref = { source: "tldr", name };
    assert.deepEqual(refFromId(refToId(ref)), ref);
  }
});

test("rejects malformed ids", () => {
  assert.equal(refFromId("nonsense"), null);
  assert.equal(refFromId("ftp::name"), null);
  assert.equal(refFromId("man:2:"), null);
});

test("refTitle renders man sections", () => {
  assert.equal(refTitle({ source: "man", name: "open", section: "2" }), "open(2)");
  assert.equal(refTitle({ source: "tldr", name: "tar" }), "tar");
});

test("name validation: argv-safe names pass, whitespace/control rejected", () => {
  assert.ok(validName("tar"));
  assert.ok(validName("(("));
  assert.ok(validName("!"));
  assert.ok(!validName(""));
  assert.ok(!validName("two words"));
  assert.ok(!validName("evil\x00"));
  assert.ok(!validName("a".repeat(200)));
});

test("section validation", () => {
  assert.ok(validSection("2"));
  assert.ok(validSection("3perl"));
  assert.ok(validSection("n"));
  assert.ok(!validSection("NOPE!"));
  assert.ok(!validSection(""));
});
