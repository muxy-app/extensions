import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

const mix = (a, b, pct) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;

const ACCENT = "var(--muxy-accent)";
const FG = "var(--muxy-foreground)";
const MUTED = "var(--muxy-foreground-muted)";

const KEYWORD = ACCENT;
const STRING = mix(ACCENT, FG, 45);
const NUMBER = mix(ACCENT, FG, 70);
const COMMENT = MUTED;
const FUNCTION = mix(ACCENT, FG, 85);
const TYPE = mix(ACCENT, FG, 60);
const CONSTANT = mix(ACCENT, FG, 75);
const PUNCT = MUTED;

export const SYNTAX_SPEC = [
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: KEYWORD },
  { tag: [t.string, t.special(t.string), t.regexp], color: STRING },
  { tag: [t.escape, t.character], color: mix(ACCENT, FG, 55) },
  { tag: [t.number, t.bool, t.integer, t.float], color: NUMBER },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: COMMENT, fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: FUNCTION },
  { tag: [t.typeName, t.className, t.namespace], color: TYPE },
  { tag: [t.constant(t.variableName), t.standard(t.name), t.atom], color: CONSTANT },
  { tag: [t.definitionKeyword, t.self], color: KEYWORD },
  { tag: [t.propertyName, t.attributeName], color: mix(ACCENT, FG, 80) },
  { tag: [t.tagName], color: KEYWORD },
  { tag: [t.attributeValue], color: STRING },
  { tag: [t.punctuation, t.separator, t.bracket, t.operator], color: PUNCT },
  { tag: [t.meta, t.processingInstruction], color: MUTED },
  { tag: [t.link], color: ACCENT, textDecoration: "underline" },
  { tag: [t.heading], color: FG, fontWeight: "bold" },
  { tag: [t.strong], fontWeight: "bold" },
  { tag: [t.emphasis], fontStyle: "italic" },
  { tag: [t.strikethrough], textDecoration: "line-through" },
  { tag: [t.invalid], color: "var(--muxy-diff-remove, var(--muxy-foreground))" },
];

export function muxy_highlight_style() {
  return syntaxHighlighting(HighlightStyle.define(SYNTAX_SPEC));
}

const PREVIEW_STYLE_ID = "muxy-files-syntax";

export function ensure_preview_highlight_css() {
  if (typeof document === "undefined") return;
  if (document.getElementById(PREVIEW_STYLE_ID)) return;
  const css = SYNTAX_SPEC.map((rule, i) => {
    const decls = [];
    if (rule.color) decls.push(`color: ${rule.color}`);
    if (rule.fontStyle) decls.push(`font-style: ${rule.fontStyle}`);
    if (rule.fontWeight) decls.push(`font-weight: ${rule.fontWeight}`);
    if (rule.textDecoration) decls.push(`text-decoration: ${rule.textDecoration}`);
    return `.md-preview .tok-${i}{${decls.join(";")}}`;
  }).join("\n");
  const style = document.createElement("style");
  style.id = PREVIEW_STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
}
