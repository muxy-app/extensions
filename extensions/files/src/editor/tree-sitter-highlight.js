import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import { syn } from "@/lib/syntax-theme";

const MAX_TREE_SITTER_DOC = 1_500_000;
const READ_CHUNK = 8192;

const CAPTURE_CLASSES = {
  comment: "comment",
  keyword: "keyword",
  conditional: "keyword",
  repeat: "keyword",
  include: "keyword",
  exception: "keyword",
  label: "keyword",
  string: "string",
  "string.special": "regexp",
  "string.regexp": "regexp",
  regexp: "regexp",
  escape: "escape",
  "string.escape": "escape",
  character: "constant",
  number: "constant",
  float: "constant",
  boolean: "constant",
  constant: "constant",
  "variable.builtin": "constant",
  "variable.member": "property",
  function: "function",
  method: "function",
  constructor: "function",
  type: "type",
  namespace: "type",
  module: "type",
  property: "property",
  field: "property",
  attribute: "property",
  tag: "tag",
  operator: "punct",
  delimiter: "punct",
  punctuation: "punct",
};

const mark_cache = new Map();

function mark_for(capture_name) {
  let key = capture_name;
  while (key) {
    const token = CAPTURE_CLASSES[key];
    if (token) {
      let mark = mark_cache.get(token);
      if (!mark) {
        mark = Decoration.mark({ class: `mxf-syn-${token}` });
        mark_cache.set(token, mark);
      }
      return mark;
    }
    const dot = key.lastIndexOf(".");
    key = dot === -1 ? "" : key.slice(0, dot);
  }
  return null;
}

const tree_sitter_theme = EditorView.baseTheme({
  ".mxf-syn-punct": { color: "var(--muxy-foreground-muted)" },
  ".mxf-syn-comment": { color: "var(--muxy-foreground-muted)", fontStyle: "italic" },
  ".mxf-syn-keyword": { color: syn("keyword") },
  ".mxf-syn-string": { color: syn("string") },
  ".mxf-syn-constant": { color: syn("constant") },
  ".mxf-syn-function": { color: syn("function") },
  ".mxf-syn-type": { color: syn("type") },
  ".mxf-syn-property": { color: syn("property") },
  ".mxf-syn-tag": { color: syn("tag") },
  ".mxf-syn-regexp": { color: syn("regexp") },
  ".mxf-syn-escape": { color: syn("escape") },
});

function tree_point(doc, pos) {
  const line = doc.lineAt(pos);
  return { row: line.number - 1, column: pos - line.from };
}

class TreeSitterHighlighter {
  constructor(view, { Parser, language, query }) {
    this.view = view;
    this.query = query;
    this.parser = new Parser();
    this.parser.setLanguage(language);
    this.tree = this.parse(view.state.doc, null);
    this.decorations = this.build(view.state.doc);
  }

  parse(doc, oldTree) {
    if (doc.length > MAX_TREE_SITTER_DOC) return null;
    const read = (index) =>
      index < doc.length ? doc.sliceString(index, Math.min(doc.length, index + READ_CHUNK)) : null;
    try {
      return this.parser.parse(read, oldTree ?? undefined);
    } catch {
      return null;
    }
  }

  update(update) {
    if (update.docChanged) {
      const old = this.tree;
      if (old) {
        let start = Infinity;
        let oldEnd = -1;
        let newEnd = -1;
        update.changes.iterChanges((fromA, toA, fromB, toB) => {
          start = Math.min(start, fromA);
          oldEnd = Math.max(oldEnd, toA);
          newEnd = Math.max(newEnd, toB);
        });
        old.edit({
          startIndex: start,
          oldEndIndex: oldEnd,
          newEndIndex: newEnd,
          startPosition: tree_point(update.startState.doc, start),
          oldEndPosition: tree_point(update.startState.doc, oldEnd),
          newEndPosition: tree_point(update.state.doc, newEnd),
        });
      }
      this.tree = this.parse(update.state.doc, old);
      old?.delete();
      this.decorations = this.build(update.state.doc);
    } else if (update.viewportChanged) {
      this.decorations = this.build(update.state.doc);
    }
  }

  build(doc) {
    if (!this.tree) return Decoration.none;
    const spans = new Map();
    for (const range of this.view.visibleRanges) {
      let captures;
      try {
        captures = this.query.captures(this.tree.rootNode, {
          startPosition: { row: doc.lineAt(range.from).number - 1, column: 0 },
          endPosition: { row: doc.lineAt(range.to).number, column: 0 },
        });
      } catch {
        return Decoration.none;
      }
      for (const capture of captures) {
        const mark = mark_for(capture.name);
        if (!mark) continue;
        const from = capture.node.startIndex;
        const to = Math.min(capture.node.endIndex, doc.length);
        if (to <= from) continue;
        spans.set(`${from}:${to}`, { from, to, mark });
      }
    }
    const sorted = [...spans.values()].sort((a, b) => a.from - b.from || b.to - a.to);
    const builder = new RangeSetBuilder();
    for (const span of sorted) builder.add(span.from, span.to, span.mark);
    return builder.finish();
  }

  destroy() {
    this.tree?.delete();
    this.tree = null;
    this.parser.delete();
  }
}

export function tree_sitter_highlight(grammar) {
  return [
    tree_sitter_theme,
    ViewPlugin.define((view) => new TreeSitterHighlighter(view, grammar), {
      decorations: (plugin) => plugin.decorations,
    }),
  ];
}
