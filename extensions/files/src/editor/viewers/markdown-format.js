import { formatWithCursor } from "prettier/standalone";
import * as markdown from "prettier/plugins/markdown";
import { extname } from "@/shared/paths";

// Loaded only when formatting is requested. CodeMirror uses LF offsets
// internally and keeps the file's original line endings when saving.
export function format_markdown(source, { filePath = "", tabSize = 2, cursorOffset = 0, printWidth = 80 } = {}) {
  return formatWithCursor(source, {
    parser: extname(filePath) === ".mdx" ? "mdx" : "markdown",
    plugins: [markdown],
    tabWidth: tabSize,
    cursorOffset,
    endOfLine: "lf",
    proseWrap: "always",
    printWidth,
    embeddedLanguageFormatting: "off",
  });
}
