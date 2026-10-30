import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  parseTldrPage, parseInline, parseCommand, commandText,
  parseTldrList, parseTldrSearch, parseApropos, parseManList, parseManGrep,
  stripOverstrike,
} from "../src/shared/parse.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures/tldr");

test("every fixture parses into name + examples", () => {
  for (const file of readdirSync(FIXTURES)) {
    const doc = parseTldrPage(readFileSync(join(FIXTURES, file), "utf8"));
    assert.ok(doc.name.length > 0, `${file}: name`);
    assert.ok(doc.description.length > 0, `${file}: description`);
    for (const ex of doc.examples) {
      assert.ok(ex.cmd.length > 0, `${file}: example command tokens`);
    }
  }
});

test("tar fixture: structure and placeholders", () => {
  const doc = parseTldrPage(readFileSync(join(FIXTURES, "tar.md"), "utf8"));
  assert.equal(doc.name, "tar");
  assert.match(doc.moreInfo, /^https:\/\/www\.gnu\.org/);
  assert.ok(doc.examples.length >= 5);

  const first = doc.examples[0];
  assert.equal(commandText(first.cmd, true),
    "tar cf {{path/to/target.tar}} {{path/to/file1 path/to/file2 ...}}");
  assert.equal(commandText(first.cmd, false),
    "tar cf path/to/target.tar path/to/file1 path/to/file2 ...");
  assert.ok(first.cmd.some((t) => t.t === "ph"));
});

test("weird page names parse (alias page with no examples ok)", () => {
  const doc = parseTldrPage(readFileSync(join(FIXTURES, "double-paren.md"), "utf8"));
  assert.equal(doc.name, "((");
});

test("parseInline: code spans and links", () => {
  const toks = parseInline("Uses `gzip` or see <https://example.com/x>.");
  assert.deepEqual(toks, [
    { t: "text", v: "Uses " },
    { t: "code", v: "gzip" },
    { t: "text", v: " or see " },
    { t: "link", v: "https://example.com/x" },
    { t: "text", v: "." },
  ]);
});

test("parseCommand: nested-bracket placeholders stay intact", () => {
  const toks = parseCommand("tar czf {{target}} {{[-C|--directory]}} {{path}} .");
  const phs = toks.filter((t) => t.t === "ph").map((t) => t.v);
  assert.deepEqual(phs, ["target", "[-C|--directory]", "path"]);
});

test("parseTldrList: one name per line, weird names kept", () => {
  assert.deepEqual(parseTldrList("!\n$\n((\ntar\n\n"), ["!", "$", "((", "tar"]);
});

test("parseTldrSearch: header skipped, columns split", () => {
  const out = "Language Platform Page\nen       linux    compress\nen       windows  compress-archive\n";
  assert.deepEqual(parseTldrSearch(out), [
    { lang: "en", platform: "linux", name: "compress" },
    { lang: "en", platform: "windows", name: "compress-archive" },
  ]);
});

test("parseApropos: multi-name lines and odd descriptions", () => {
  const out = [
    "4ccconv(1)               - 4 Character Code Conversion Tool",
    "@TSET@(1), reset(1)      - terminal initialization",
    "AEServer(8)              - AEServer(8) -- System-wide daemon",
    "not a real line",
  ].join("\n");
  const rows = parseApropos(out);
  assert.deepEqual(rows.map((r) => `${r.name}(${r.section})`),
    ["4ccconv(1)", "@TSET@(1)", "reset(1)", "AEServer(8)"]);
  assert.equal(rows[1].desc, "terminal initialization");
  assert.equal(rows[2].desc, "terminal initialization");
  assert.equal(rows[3].desc, "AEServer(8) -- System-wide daemon");
});

test("parseApropos: overlapping manpath roots are deduped", () => {
  // `apropos .` repeats a page once per root that ships it (system tree plus
  // the Xcode SDK trees), which put every man page in the picker twice.
  const out = [
    "tar(1)  - manipulate tape archives",
    "tar(5)  - format of tape archive files",
    "tar(1)  - manipulate tape archives",
    "tar(5)  - format of tape archive files",
  ].join("\n");
  assert.deepEqual(parseApropos(out), [
    { name: "tar", section: "1", desc: "manipulate tape archives" },
    { name: "tar", section: "5", desc: "format of tape archive files" },
  ]);
});

test("parseManList: compression stripped, sections split, deduped", () => {
  const rows = parseManList("open.2\ntar.1.gz\nzshall.1\nopen.2\nREADME\n");
  assert.deepEqual(rows, [
    { name: "open", section: "2", desc: "" },
    { name: "tar", section: "1", desc: "" },
    { name: "zshall", section: "1", desc: "" },
  ]);
});

test("parseManGrep: paths to name+section, deduped across roots", () => {
  const rows = parseManGrep([
    "/usr/share/man/man1/tar.1",
    "/usr/share/man/man3/removefile_state_get.3",
    "/usr/share/man/mann/vfs-fsapi.n",
    "/opt/homebrew/share/man/man1/tar.1.gz",              // same page, other root
    "/Applications/Xcode.app/.../share/man/man1/tar.1",   // and again
    "/usr/share/man/whatis",                              // not a man page
    "",
  ].join("\n"));
  assert.deepEqual(rows, [
    { name: "tar", section: "1", desc: "" },
    { name: "removefile_state_get", section: "3", desc: "" },
    { name: "vfs-fsapi", section: "n", desc: "" },
  ]);
});

test("stripOverstrike: bold, underline, plain runs", () => {
  const runs = stripOverstrike("N\bNA\bAM\bME\bE\n     plain _\bo_\bp");
  assert.deepEqual(runs, [
    { text: "NAME", bold: true, underline: false },
    { text: "\n     plain ", bold: false, underline: false },
    { text: "op", bold: false, underline: true },
  ]);
});

test("stripOverstrike: stray backspaces and mixed pairs survive", () => {
  const runs = stripOverstrike("a\bb x\b");
  assert.equal(runs.map((r) => r.text).join(""), "b x");
});
