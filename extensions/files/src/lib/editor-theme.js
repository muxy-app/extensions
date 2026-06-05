import { EditorView } from "@codemirror/view";

export function muxy_cm_theme(is_dark) {
  return EditorView.theme(
    {
      "&": {
        backgroundColor: "var(--muxy-background)",
        color: "var(--muxy-foreground)",
      },
      "&.cm-focused": { outline: "none" },
      ".cm-content": {
        fontFamily: '"SF Mono", Menlo, monospace',
      },
      ".cm-gutters": {
        backgroundColor: "var(--muxy-background)",
        color: "color-mix(in srgb, var(--muxy-foreground-muted) 55%, transparent)",
        border: "none",
        borderRight: "1px solid var(--muxy-border)",
      },
      ".cm-activeLine": { backgroundColor: "var(--muxy-hover)" },
      ".cm-activeLineGutter": {
        backgroundColor: "var(--muxy-hover)",
        color: "var(--muxy-foreground)",
      },
      ".cm-lineNumbers .cm-gutterElement": {
        padding: "0 8px",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--muxy-foreground)",
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "var(--muxy-accent-soft)",
      },
      ".cm-searchMatch": {
        backgroundColor: "var(--muxy-accent-soft)",
        outline: "1px solid color-mix(in srgb, var(--muxy-accent) 45%, transparent)",
      },
      ".cm-searchMatch.cm-searchMatch-selected": {
        backgroundColor: "color-mix(in srgb, var(--muxy-accent) 40%, transparent)",
      },
      ".cm-panels": {
        backgroundColor: "var(--muxy-background)",
        color: "var(--muxy-foreground)",
        fontFamily: '-apple-system, "SF Pro", system-ui, sans-serif',
      },
      ".cm-panels.cm-panels-top": {
        borderBottom: "1px solid var(--muxy-border)",
      },
      ".cm-panel.cm-search.cm-find-panel": {
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        minHeight: "32px",
        gap: "var(--s2)",
        padding: "var(--s2) var(--s5)",
        backgroundColor: "var(--muxy-background)",
        color: "var(--muxy-foreground)",
        fontFamily: '-apple-system, "SF Pro", system-ui, sans-serif',
        fontSize: "var(--font-body)",
        lineHeight: "1",
      },
      ".cm-find-panel": {
        width: "100%",
      },
      ".cm-find-row": {
        display: "flex",
        width: "100%",
        minHeight: "24px",
        alignItems: "center",
        gap: "var(--s2)",
      },
      ".cm-replace-row[hidden]": {
        display: "none",
      },
      ".cm-panel.cm-search.cm-find-panel input, .cm-panel.cm-search.cm-find-panel button, .cm-panel.cm-search.cm-find-panel label": {
        margin: "0",
      },
      ".cm-search label": {
        display: "inline-flex",
        height: "24px",
        alignItems: "center",
        gap: "var(--s2)",
        color: "var(--muxy-foreground-muted)",
        fontSize: "var(--font-body)",
        whiteSpace: "nowrap",
      },
      ".cm-search input[type='checkbox']": {
        width: "14px",
        height: "14px",
        margin: "0",
        accentColor: "var(--muxy-accent)",
      },
      ".cm-textfield": {
        boxSizing: "border-box",
        width: "220px",
        height: "24px",
        backgroundColor: "var(--muxy-surface)",
        color: "var(--muxy-foreground)",
        border: "1px solid var(--muxy-border)",
        borderRadius: "6px",
        padding: "0 var(--s4)",
        fontFamily: '-apple-system, "SF Pro", system-ui, sans-serif',
        fontSize: "var(--font-body)",
        lineHeight: "22px",
      },
      ".cm-textfield:focus": {
        outline: "none",
        borderColor: "var(--muxy-accent)",
      },
      ".cm-button": {
        boxSizing: "border-box",
        height: "24px",
        backgroundColor: "var(--muxy-surface)",
        backgroundImage: "none",
        color: "var(--muxy-foreground)",
        border: "1px solid var(--muxy-border)",
        borderRadius: "6px",
        padding: "0 var(--s4)",
        fontFamily: '-apple-system, "SF Pro", system-ui, sans-serif',
        fontSize: "var(--font-body)",
        lineHeight: "22px",
      },
      ".cm-button:hover": {
        backgroundColor: "var(--muxy-hover)",
      },
      ".cm-button.cm-button-active, .cm-button[aria-expanded='true']": {
        backgroundColor: "var(--muxy-accent-soft)",
        borderColor: "var(--muxy-accent)",
      },
      ".cm-panel.cm-search.cm-find-panel button[name=close]": {
        position: "static",
        inset: "auto",
        display: "inline-flex",
        width: "24px",
        height: "24px",
        flex: "0 0 24px",
        alignItems: "center",
        justifyContent: "center",
        alignSelf: "center",
        padding: "0",
        margin: "0",
        marginLeft: "auto",
        border: "0",
        borderRadius: "6px",
        background: "transparent",
        color: "var(--muxy-foreground-muted)",
      },
      ".cm-panel.cm-search.cm-find-panel button[name=close]:hover": {
        backgroundColor: "var(--muxy-hover)",
        color: "var(--muxy-foreground)",
      },
      ".cm-panel.cm-search.cm-find-panel button[name=close] svg": {
        width: "14px",
        height: "14px",
      },
    },
    { dark: is_dark },
  );
}
