import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { find_colors_in_line } from "@/lib/color-detect";
import { openColorPicker } from "@/editor/color-picker";

class SwatchWidget extends WidgetType {
  constructor(hex, literal) {
    super();
    this.hex = hex;
    this.literal = literal;
  }

  eq(other) {
    return other.hex === this.hex && other.literal === this.literal;
  }

  toDOM(view) {
    const swatch = document.createElement("span");
    swatch.className = "cm-color-swatch";
    swatch.setAttribute("aria-hidden", "true");
    swatch.style.setProperty("--swatch-color", this.hex);

    swatch.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    swatch.addEventListener("click", (event) => {
      event.preventDefault();
      this.open(view, swatch);
    });

    return swatch;
  }

  open(view, swatch) {
    const initial = this.locate(view, swatch);
    if (!initial) return;
    let range = initial;

    openColorPicker({
      anchorRect: swatch.getBoundingClientRect(),
      hex: this.hex,
      onChange: (nextHex) => {
        if (!view.dom.isConnected) return;
        const { from, to } = range;
        view.dispatch({
          changes: { from, to, insert: nextHex },
          userEvent: "input.color",
        });
        range = { from, to: from + nextHex.length };
      },
    });
  }

  locate(view, swatch) {
    let hintPos = null;
    try {
      hintPos = view.posAtDOM(swatch);
    } catch {
      hintPos = null;
    }
    const doc = view.state.doc;
    const lineNo = hintPos == null ? null : doc.lineAt(hintPos).number;
    const scan = lineNo == null
      ? Array.from({ length: doc.lines }, (_, i) => doc.line(i + 1))
      : [doc.line(lineNo)];
    for (const line of scan) {
      for (const color of find_colors_in_line(line.text)) {
        if (color.text === this.literal && color.hex === this.hex) {
          return { from: line.from + color.from, to: line.from + color.to };
        }
      }
    }
    return null;
  }

  ignoreEvent() {
    return true;
  }
}

function buildDecorations(view) {
  const builder = new RangeSetBuilder();
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      for (const color of find_colors_in_line(line.text)) {
        const start = line.from + color.from;
        const widget = Decoration.widget({
          widget: new SwatchWidget(color.hex, color.text),
          side: -1,
        });
        builder.add(start, start, widget);
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

const colorSwatchPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildDecorations(view);
    }

    update(update) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

const colorSwatchTheme = EditorView.baseTheme({
  ".cm-color-swatch": {
    display: "inline-block",
    boxSizing: "border-box",
    width: "0.85em",
    height: "0.85em",
    marginRight: "0.3em",
    verticalAlign: "middle",
    borderRadius: "4px",
    background: "var(--swatch-color)",
    boxShadow: "inset 0 0 0 1px var(--muxy-border)",
    cursor: "pointer",
  },
});

export function colorSwatchExtension() {
  return [colorSwatchPlugin, colorSwatchTheme];
}
