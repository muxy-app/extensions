// Single CodeMirror 6 adapter module. Everything the review tab needs is
// imported here from the `@codemirror/*` npm packages (declared in
// package.json) and re-exported, so the one esbuild pass over review.js keeps a
// single @codemirror/state instance (mixing separate per-language copies breaks
// CM6). npm dedupes @codemirror/state to one version at install time, and
// esbuild inlines that single copy.

export { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, highlightSpecialChars, rectangularSelection, crosshairCursor, Decoration, WidgetType, gutter, GutterMarker } from '@codemirror/view';
export { EditorState, Compartment, StateField, StateEffect, RangeSet, RangeSetBuilder } from '@codemirror/state';
export { syntaxHighlighting, HighlightStyle, foldGutter, foldKeymap, bracketMatching, indentOnInput, indentUnit } from '@codemirror/language';
export { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
export { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
export { tags } from '@lezer/highlight';

// --- Languages -------------------------------------------------------------
// Real Lezer-grammar language packages (best highlighting).
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { python } from '@codemirror/lang-python';
import { markdown } from '@codemirror/lang-markdown';
import { php } from '@codemirror/lang-php';
import { rust } from '@codemirror/lang-rust';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { xml } from '@codemirror/lang-xml';
import { sql } from '@codemirror/lang-sql';
import { yaml } from '@codemirror/lang-yaml';
import { go } from '@codemirror/lang-go';
import { StreamLanguage } from '@codemirror/language';

// Broad coverage for everything else via CodeMirror 5 legacy stream modes.
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { perl } from '@codemirror/legacy-modes/mode/perl';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { nginx } from '@codemirror/legacy-modes/mode/nginx';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { r } from '@codemirror/legacy-modes/mode/r';
import { haskell } from '@codemirror/legacy-modes/mode/haskell';
import { clojure } from '@codemirror/legacy-modes/mode/clojure';
import { erlang } from '@codemirror/legacy-modes/mode/erlang';
import { julia } from '@codemirror/legacy-modes/mode/julia';
import { c, objectiveC, kotlin, scala, csharp, dart } from '@codemirror/legacy-modes/mode/clike';

const stream = (mode) => StreamLanguage.define(mode);

// Map a lowercased file extension to a language Extension factory.
const BY_EXT = {
  js: javascript, jsx: () => javascript({ jsx: true }), mjs: javascript, cjs: javascript,
  ts: () => javascript({ typescript: true }), tsx: () => javascript({ typescript: true, jsx: true }),
  mts: () => javascript({ typescript: true }), cts: () => javascript({ typescript: true }),
  json: json, jsonc: json, json5: json,
  html: html, htm: html, xhtml: html, vue: html, svelte: html,
  css: css, scss: css, less: css, sass: css,
  py: python, pyw: python, pyi: python,
  md: markdown, markdown: markdown, mdx: markdown,
  php: php, phtml: php,
  rs: rust,
  c: () => stream(c), h: () => stream(c),
  cc: cpp, cpp: cpp, cxx: cpp, hpp: cpp, hh: cpp, hxx: cpp,
  m: () => stream(objectiveC), mm: () => stream(objectiveC),
  java: java, kt: () => stream(kotlin), kts: () => stream(kotlin),
  scala: () => stream(scala), sc: () => stream(scala),
  cs: () => stream(csharp), dart: () => stream(dart),
  xml: xml, svg: xml, plist: xml, xsl: xml, xslt: xml,
  sql: sql,
  yaml: yaml, yml: yaml,
  go: go,
  sh: () => stream(shell), bash: () => stream(shell), zsh: () => stream(shell), fish: () => stream(shell),
  rb: () => stream(ruby), gemspec: () => stream(ruby), rake: () => stream(ruby),
  swift: () => stream(swift),
  lua: () => stream(lua),
  pl: () => stream(perl), pm: () => stream(perl),
  toml: () => stream(toml),
  dockerfile: () => stream(dockerFile),
  nginx: () => stream(nginx), conf: () => stream(nginx),
  ini: () => stream(properties), cfg: () => stream(properties), properties: () => stream(properties), env: () => stream(properties),
  diff: () => stream(diff), patch: () => stream(diff),
  ps1: () => stream(powerShell), psm1: () => stream(powerShell),
  r: () => stream(r),
  hs: () => stream(haskell),
  clj: () => stream(clojure), cljs: () => stream(clojure), edn: () => stream(clojure),
  erl: () => stream(erlang), hrl: () => stream(erlang),
  jl: () => stream(julia),
};

// Some files are identified by their basename, not extension.
const BY_NAME = {
  dockerfile: () => stream(dockerFile),
  makefile: () => stream(properties),
  '.gitignore': () => stream(properties),
  '.npmrc': () => stream(properties),
  '.editorconfig': () => stream(properties),
};

// Return a CodeMirror language Extension for the given file path, or null
// (plaintext) when nothing matches.
export function languageFor(path) {
  if (!path) return null;
  const base = path.split('/').pop().toLowerCase();
  if (BY_NAME[base]) return BY_NAME[base]();
  const dot = base.lastIndexOf('.');
  const ext = dot >= 0 ? base.slice(dot + 1) : base;
  const factory = BY_EXT[ext];
  return factory ? factory() : null;
}
