import { StateEffect, StateField } from "@codemirror/state";
import { EditorView, gutter, GutterMarker } from "@codemirror/view";
import { diff_lines } from "@/lib/line-diff";

export const setGitBaseline = StateEffect.define();

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

function compute_marks(baseline, doc) {
  if (baseline === null || baseline === undefined) return null;
  const result = diff_lines(baseline, doc.toString());
  if (result.skipped) return null;
  const lineCount = doc.lines;
  const marks = new Map();
  for (const [zeroIndex, kind] of result.changed) {
    marks.set(zeroIndex + 1, { kind, deletionBefore: false, deletionAfter: false });
  }
  for (const zeroIndex of result.removedBefore) {
    const lineNumber = Math.min(zeroIndex + 1, lineCount);
    const entry = marks.get(lineNumber) ?? { kind: null, deletionBefore: false, deletionAfter: false };
    entry.deletionBefore = true;
    marks.set(lineNumber, entry);
  }
  if (result.removedAtEnd) {
    const entry = marks.get(lineCount) ?? { kind: null, deletionBefore: false, deletionAfter: false };
    entry.deletionAfter = true;
    marks.set(lineCount, entry);
  }
  return marks;
}

const gitBaselineField = StateField.define({
  create() {
    return { baseline: null, marks: null };
  },
  update(value, tr) {
    let baseline = value.baseline;
    let dirty = false;
    for (const effect of tr.effects) {
      if (effect.is(setGitBaseline)) {
        baseline = effect.value;
        dirty = true;
      }
    }
    if (!dirty && !tr.docChanged) return value;
    return { baseline, marks: compute_marks(baseline, tr.state.doc) };
  },
});

const markerCache = new Map();

function marker_for(entry) {
  const key = `${entry.kind ?? ""}|${entry.deletionBefore ? 1 : 0}|${entry.deletionAfter ? 1 : 0}`;
  let marker = markerCache.get(key);
  if (!marker) {
    marker = new ChangeMarker(entry.kind, entry.deletionBefore, entry.deletionAfter);
    markerCache.set(key, marker);
  }
  return marker;
}

const gitGutter = gutter({
  class: "cm-git-gutter",
  renderEmptyElements: true,
  lineMarker(view, line) {
    const marks = view.state.field(gitBaselineField).marks;
    if (!marks) return null;
    const lineNumber = view.state.doc.lineAt(line.from).number;
    const entry = marks.get(lineNumber);
    if (!entry) return null;
    return marker_for(entry);
  },
  lineMarkerChange(update) {
    return update.startState.field(gitBaselineField).marks !== update.state.field(gitBaselineField).marks;
  },
});

const gitGutterTheme = EditorView.baseTheme({
  ".cm-git-gutter": {
    width: "3px",
    padding: "0",
  },
  ".cm-git-marker": {
    position: "relative",
    width: "100%",
    height: "100%",
  },
  ".cm-git-added": {
    background: "var(--muxy-diff-add)",
  },
  ".cm-git-modified": {
    background: "var(--muxy-accent)",
  },
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
  ".cm-git-deletion-before::before": {
    top: "-3px",
  },
  ".cm-git-deletion-after::after": {
    bottom: "-3px",
  },
});

export function gitGutterExtension() {
  return [gitBaselineField, gitGutter, gitGutterTheme];
}
