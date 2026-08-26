/**
 * Minimal, throw-free YAML frontmatter parser for GSD artifacts.
 * Supports the observed subset: nested maps by indentation, scalars
 * (quoted strings, numbers, booleans, null), inline `[a, b]` arrays and
 * `- item` sequence blocks. Anything else degrades to strings — never throws.
 */

/** @param {string} text @returns {{data: Record<string, any>, body: string, hasFrontmatter: boolean}} */
export function splitFrontmatter(text) {
  if (typeof text !== "string") return { data: {}, body: "", hasFrontmatter: false };
  const normalized = text.replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
  if (!m) return { data: {}, body: normalized, hasFrontmatter: false };
  return { data: parseYamlSubset(m[1]), body: normalized.slice(m[0].length), hasFrontmatter: true };
}

/** @param {string} src @returns {Record<string, any>} */
export function parseYamlSubset(src) {
  const lines = String(src ?? "").split("\n");
  /** @type {any[]} */ const stack = [{}];
  /** @type {number[]} */ const indents = [-1];

  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();

    while (indents.length > 1 && indent <= indents[indents.length - 1]) {
      indents.pop();
      stack.pop();
    }
    const parent = stack[stack.length - 1];

    if (line.startsWith("- ")) {
      const value = scalar(line.slice(2));
      // Sequences replace the placeholder map created for their key.
      const pendingKey = /** @type {any} */ (parent).__pendingKey;
      const holder = /** @type {any} */ (parent).__parent ?? parent;
      if (pendingKey != null) {
        const arr = Array.isArray(holder[pendingKey]) ? holder[pendingKey] : [];
        arr.push(value);
        holder[pendingKey] = arr;
      } else if (Array.isArray(parent)) {
        parent.push(value);
      }
      continue;
    }

    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().replace(/^["']|["']$/g, "");
    const rest = line.slice(idx + 1).trim();

    if (rest === "") {
      // Could become a nested map or a sequence; decide when children arrive.
      const placeholder = { __pendingKey: key, __parent: parent };
      parent[key] = placeholder;
      stack.push(placeholder);
      indents.push(indent);
      continue;
    }

    parent[key] = scalar(rest);
  }

  // Convert unfilled `{__pendingKey}` placeholders into `null`
  // (a bare `key:` in these artifacts means "no value").
  return finalize(stack[0]);
}

function finalize(node) {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) {
    return node.map((n) => finalize(n));
  }
  const keys = Object.keys(node).filter((k) => k !== "__pendingKey" && k !== "__parent");
  const isPlaceholder = "__pendingKey" in node;
  if (keys.length === 0 && isPlaceholder) return null;
  /** @type {Record<string, any>} */
  const out = {};
  for (const k of keys) out[k] = finalize(node[k]);
  return out;
}

/** @param {string} s */
function scalar(s) {
  const v = s.trim();
  if (v === "" || v === "~" || v === "null" || v === "Null" || v === "null (unset)") return null;
  if (v === "true" || v === "True") return true;
  if (v === "false" || v === "False") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((p) => {
      let item = p.trim();
      item = item.replace(/^["']|["']$/g, "");
      return item;
    }).filter((p) => p !== "");
  }
  if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
      (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) {
    return v.slice(1, -1);
  }
  return v;
}
