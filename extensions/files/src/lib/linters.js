import { linter } from "@codemirror/lint";
import { parse as parseJsonc } from "jsonc-parser";
import { parseDocument } from "yaml";
import { extname } from "@/lib/files";

// Strict JSON (.json, manifests) flags comments and trailing commas; JSONC/JSON5
// permit them. jsonc-parser reports precise offsets either way — unlike V8's
// JSON.parse, whose error messages omit the position about half the time.
const STRICT_JSON_EXT = new Set([".json", ".webmanifest"]);
const LOOSE_JSON_EXT = new Set([".jsonc", ".json5"]);
const YAML_EXT = new Set([".yaml", ".yml"]);

// jsonc-parser ParseErrorCode → human message (codes are a stable enum).
const JSONC_ERROR_MESSAGE = {
  1: "Invalid symbol",
  2: "Invalid number format",
  3: "Property name expected",
  4: "Value expected",
  5: "Colon expected",
  6: "Comma expected",
  7: "Closing brace '}' expected",
  8: "Closing bracket ']' expected",
  9: "End of file expected",
  10: "Invalid comment token",
  11: "Unexpected end of comment",
  12: "Unexpected end of string",
  13: "Unexpected end of number",
  14: "Invalid unicode escape",
  15: "Invalid escape character",
  16: "Invalid character",
};

// Clamp an offset into the document so a stale/odd position from a parser can
// never throw when CodeMirror builds the diagnostic range.
function clamp(pos, length) {
  if (!Number.isFinite(pos)) return 0;
  return Math.max(0, Math.min(pos, length));
}

function makeJsonLinter(loose) {
  return linter((view) => {
    const doc = view.state.doc;
    const text = doc.toString();
    if (text.trim() === "") return [];
    const length = doc.length;
    const errors = [];
    parseJsonc(text, errors, {
      allowTrailingComma: loose,
      disallowComments: !loose,
      allowEmptyContent: true,
    });
    return errors.map((e) => ({
      from: clamp(e.offset, length),
      to: clamp(e.offset + (e.length || 1), length),
      severity: "error",
      message: JSONC_ERROR_MESSAGE[e.error] ?? "Invalid JSON",
    }));
  });
}

const strictJsonLinter = makeJsonLinter(false);
const looseJsonLinter = makeJsonLinter(true);

const yamlLinter = linter((view) => {
  const doc = view.state.doc;
  const text = doc.toString();
  if (text.trim() === "") return [];
  const length = doc.length;
  let parsed;
  try {
    parsed = parseDocument(text, { prettyErrors: true });
  } catch (error) {
    return [{ from: 0, to: Math.min(1, length), severity: "error", message: error.message ?? "Invalid YAML" }];
  }
  const diagnostics = [];
  const collect = (items, severity) => {
    for (const item of items ?? []) {
      const [start, end] = item.pos ?? [0, 1];
      diagnostics.push({
        from: clamp(start, length),
        to: clamp(end, length),
        severity,
        message: item.message ?? (severity === "error" ? "YAML error" : "YAML warning"),
      });
    }
  };
  collect(parsed.errors, "error");
  collect(parsed.warnings, "warning");
  return diagnostics;
});

export function linter_for(path) {
  const ext = extname(path);
  if (STRICT_JSON_EXT.has(ext)) return strictJsonLinter;
  if (LOOSE_JSON_EXT.has(ext)) return looseJsonLinter;
  if (YAML_EXT.has(ext)) return yamlLinter;
  return null;
}
