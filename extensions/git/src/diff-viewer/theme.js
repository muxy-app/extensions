import { registerCustomCSSVariableTheme } from "@pierre/diffs";

export const MUXY_DIFF_THEME = "muxy-diffs";

const tint = (mix, base = "var(--muxy-foreground)") =>
  `color-mix(in srgb, ${base} ${mix}%, var(--muxy-accent) ${100 - mix}%)`;

const VARIABLE_DEFAULTS = {
  foreground: "var(--muxy-foreground)",
  background: "var(--muxy-background)",
  "token-comment": "var(--muxy-foreground-muted)",
  "token-string": tint(35),
  "token-string-expression": tint(35),
  "token-keyword": tint(15),
  "token-constant": tint(45),
  "token-function": tint(25),
  "token-parameter": "var(--muxy-foreground)",
  "token-punctuation": "var(--muxy-foreground-muted)",
  "token-link": "var(--muxy-accent)",
  "token-inserted": "var(--muxy-diff-add)",
  "token-deleted": "var(--muxy-diff-remove)",
  "token-changed": "var(--muxy-diff-hunk)",
};

export const HEADER_CSS = `
[data-diffs-header][data-diffs-header] {
  cursor: pointer;
  background-color: var(--bg);
  background-image: linear-gradient(var(--diff-header-bg), var(--diff-header-bg));
  border-bottom: 1px solid var(--diff-header-border);
  min-height: 0;
  height: calc(34px * var(--diff-zoom, 1));
}
[data-diffs-header][data-diffs-header]:hover {
  background-image: linear-gradient(var(--diff-header-hover), var(--diff-header-hover));
}
[data-diffs-header] [data-title] {
  font-weight: 600;
}
`;

let registered = false;

export function registerMuxyDiffTheme() {
  if (registered) return MUXY_DIFF_THEME;
  registerCustomCSSVariableTheme(MUXY_DIFF_THEME, VARIABLE_DEFAULTS, true);
  registered = true;
  return MUXY_DIFF_THEME;
}
