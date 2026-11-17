// Git change bars in the gutter. Markers are a RangeSet: each keystroke only
// maps them through the change (cheap), and the real diff against HEAD runs
// once typing pauses, off the input path.

import { RangeSet, StateEffect, StateField } from "@codemirror/state";
import { EditorView, gutter, GutterMarker, ViewPlugin } from "@codemirror/view";
import { diff_line_arrays, split_lines } from "./line-diff";

const DIFF_DELAY_MS = 250;
const MAX_GUTTER_LINES = 50_000;

const setBaseline = StateEffect.define();
const setMarks = StateEffect.define();

class ChangeMarker extends GutterMarker {
  constructor(kind, deletionBefore, deletionAfter) {
    super();
    this.kind = kind;
    this.deletionBefore = deletionBefore;
    this.deletionAfter = deletionAfter;
  }

  eq(other) {
    return (
      this.kind === other.kind &&
      this.deletionBefore === other.deletionBefore &&
      this.deletionAfter === other.deletionAfter
    );
  }

  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-git-marker";
    if (this.kind) el.classList.add(`cm-git-${this.kind}`);
    if (this.deletionBefore) el.classList.add("cm-git-deletion-before");
    if (this.deletionAfter) el.classList.add("cm-git-deletion-after");
    return el;
  }
}

const markerCache = new Map();

function marker_for(kind, deletionBefore, deletionAfter) {
  const key = `${kind ?? ""}|${deletionBefore ? 1 : 0}|${deletionAfter ? 1 : 0}`;
  let marker = markerCache.get(key);
  if (!marker) {
    marker = new ChangeMarker(kind, deletionBefore, deletionAfter);
    markerCache.set(key, marker);
  }
  return marker;
}

const gitField = StateField.define({
  create() {
    return { baseLines: null, marks: RangeSet.empty };
  },
  update(value, tr) {
    let next = value;
    if (tr.docChanged && value.marks.size > 0) next = { ...next, marks: value.marks.map(tr.changes) };
    for (const effect of tr.effects) {
      if (effect.is(setBaseline)) next = { baseLines: effect.value, marks: effect.value ? next.marks : RangeSet.empty };
      else if (effect.is(setMarks)) next = { ...next, marks: effect.value };
    }
    return next;
  },
});

function compute_marks(baseLines, doc) {
  if (!baseLines || doc.lines > MAX_GUTTER_LINES) return RangeSet.empty;
  const current = [];
  for (const line of doc.iterLines()) current.push(line);
  const result = diff_line_arrays(baseLines, current);
  if (result.skipped) return RangeSet.empty;

  const lineCount = doc.lines;
  const entries = new Map();
  const entry = (lineNumber) => {
    let item = entries.get(lineNumber);
    if (!item) {
      item = { kind: null, before: false, after: false };
      entries.set(lineNumber, item);
    }
    return item;
  };
  for (const [index, kind] of result.changed) entry(index + 1).kind = kind;
  for (const index of result.removedBefore) entry(Math.min(index + 1, lineCount)).before = true;
  if (result.removedAtEnd) entry(lineCount).after = true;

  const ranges = [...entries.entries()]
    .filter(([lineNumber]) => lineNumber >= 1 && lineNumber <= lineCount)
    .sort((x, y) => x[0] - y[0])
    .map(([lineNumber, item]) => marker_for(item.kind, item.before, item.after).range(doc.line(lineNumber).from));
  return RangeSet.of(ranges);
}

const idle =
  typeof requestIdleCallback === "function"
    ? (fn) => requestIdleCallback(fn, { timeout: 500 })
    : (fn) => setTimeout(fn, 0);
const cancelIdle = typeof cancelIdleCallback === "function" ? cancelIdleCallback : clearTimeout;

const differ = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.view = view;
      this.timer = 0;
      this.idle = 0;
    }

    update(update) {
      const baselineChanged = update.transactions.some((tr) => tr.effects.some((e) => e.is(setBaseline)));
      if (baselineChanged || (update.docChanged && update.state.field(gitField).baseLines)) this.schedule(baselineChanged ? 0 : DIFF_DELAY_MS);
    }

    schedule(delay) {
      clearTimeout(this.timer);
      cancelIdle(this.idle);
      this.timer = setTimeout(() => {
        this.idle = idle(() => this.run());
      }, delay);
    }

    run() {
      const { state } = this.view;
      const { baseLines } = state.field(gitField);
      const marks = compute_marks(baseLines, state.doc);
      // Typing since the diff started would make its positions stale.
      if (this.view.state.doc !== state.doc) return this.schedule(DIFF_DELAY_MS);
      this.view.dispatch({ effects: setMarks.of(marks) });
    }

    destroy() {
      clearTimeout(this.timer);
      cancelIdle(this.idle);
    }
  },
);

const gitGutter = gutter({
  class: "cm-git-gutter",
  markers: (view) => view.state.field(gitField).marks,
});

const gitGutterTheme = EditorView.baseTheme({
  ".cm-git-gutter": { width: "3px", padding: "0" },
  ".cm-git-gutter .cm-gutterElement": { padding: "0" },
  ".cm-git-marker": { position: "relative", width: "100%", height: "100%" },
  ".cm-git-added": { background: "var(--muxy-diff-add)" },
  ".cm-git-modified": { background: "var(--muxy-accent)" },
  ".cm-git-deletion-before::before, .cm-git-deletion-after::after": {
    content: '""',
    position: "absolute",
    left: "0",
    width: "0",
    height: "0",
    borderLeft: "3px solid var(--muxy-diff-remove)",
    borderTop: "3px solid transparent",
    borderBottom: "3px solid transparent",
  },
  ".cm-git-deletion-before::before": { top: "-3px" },
  ".cm-git-deletion-after::after": { bottom: "-3px" },
});

export function git_gutter() {
  return [gitField, differ, gitGutter, gitGutterTheme];
}

/** Effect that sets (or clears, with null) the HEAD text to compare against. */
export function set_git_baseline(text) {
  return setBaseline.of(typeof text === "string" ? split_lines(text) : null);
}
