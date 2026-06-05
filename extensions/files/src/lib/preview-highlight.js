import { highlightCode, tagHighlighter } from "@lezer/highlight";
import { language_for_name } from "@/lib/languages";
import { SYNTAX_SPEC } from "@/lib/syntax-theme";

const highlighter = tagHighlighter(
  SYNTAX_SPEC.map((rule, i) => ({
    tag: rule.tag,
    class: `tok-${i}`,
  })),
);

export async function highlight_code(code, lang) {
  const support = lang ? await language_for_name(lang) : null;
  if (!support) return [{ text: code, cls: "" }];

  const tree = support.language.parser.parse(code);
  const parts = [];
  highlightCode(
    code,
    tree,
    highlighter,
    (text, classes) => parts.push({ text, cls: classes }),
    () => parts.push({ text: "\n", cls: "" }),
  );
  return parts;
}
