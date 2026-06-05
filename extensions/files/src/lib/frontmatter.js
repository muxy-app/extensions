import { parse as parseYaml } from "yaml";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function format_value(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(format_value).join(", ");
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, nested]) => `${key}: ${format_value(nested)}`)
      .join(", ");
  }
  return String(value);
}

export function split_frontmatter(source) {
  const match = FRONTMATTER_RE.exec(source);
  if (!match) return { fields: [], body: source };

  try {
    const data = parseYaml(match[1]);
    if (!data || typeof data !== "object" || Array.isArray(data)) return { fields: [], body: source };
    const fields = Object.entries(data).map(([key, value]) => ({ key, value: format_value(value) }));
    return { fields, body: source.slice(match[0].length) };
  } catch {
    return { fields: [], body: source };
  }
}
