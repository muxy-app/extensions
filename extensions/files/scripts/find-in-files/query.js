import {
  MAX_QUERY_VARIANTS,
  MAX_TITLE_LENGTH,
  MIN_LATIN_QUERY_LENGTH,
  MIN_QUERY_LENGTH,
} from "./constants.js";

export function result_id(filePath, lineNumber) {
  return JSON.stringify({ filePath, lineNumber });
}

export function parse_result_id(id) {
  try {
    const parsed = JSON.parse(id);
    if (!parsed || typeof parsed.filePath !== "string") return null;
    const lineNumber = Number(parsed.lineNumber);
    if (!Number.isFinite(lineNumber) || lineNumber < 1) return null;
    return { filePath: parsed.filePath, lineNumber };
  } catch {
    return null;
  }
}

export function parse_result_line(line) {
  const parsed = split_result_line(line);
  if (!parsed) return null;

  const filePath = workspace_path(parsed.filePath);
  if (!filePath) return null;

  return {
    id: result_id(filePath, parsed.lineNumber),
    title: title_for(parsed.content),
    subtitle: `${filePath}:${parsed.lineNumber}`,
  };
}

export function search_options(raw) {
  const options = raw || {};
  return {
    caseSensitive: options.caseSensitive === true,
    wholeWord: options.wholeWord === true,
    regex: options.regex === true,
  };
}

export function query_variants(query, options) {
  const variants = new Set();
  const normalized = normalized_query(query);
  if (!normalized) return [];
  variants.add(normalized);
  variants.add(normalized.normalize("NFD"));
  if (options.regex) return Array.from(variants);

  let combinations = [""];
  for (const character of Array.from(normalized)) {
    const forms = Array.from(new Set([character, character.normalize("NFD")]));
    combinations = expand_combinations(combinations, forms);
  }
  for (const variant of combinations) {
    variants.add(variant);
    if (variants.size >= MAX_QUERY_VARIANTS) break;
  }
  return Array.from(variants);
}

export function is_search_too_short(query, options) {
  if (is_short_query(query)) return true;
  if (!options.regex) return is_short_query(query);
  return regex_min_match_length(query) < MIN_QUERY_LENGTH;
}

export function pattern_stdin(variants) {
  return `${variants.join("\n")}\n`;
}

// rg runs with --null, so it emits "path\0line:content" and the path may itself
// contain colons. grep has no such option and emits "path:line:content"; there we
// fall back to splitting on the first colon, since a path containing one is rarer
// than a matched line that starts with digits and a colon.
function split_result_line(line) {
  const nul = line.indexOf("\0");
  if (nul > 0) {
    const rest = line.slice(nul + 1);
    const colon = rest.indexOf(":");
    if (colon <= 0) return null;
    const lineNumber = line_number_of(rest.slice(0, colon));
    if (!lineNumber) return null;
    return { filePath: line.slice(0, nul), lineNumber, content: rest.slice(colon + 1) };
  }

  const first = line.indexOf(":");
  if (first <= 0) return null;
  const second = line.indexOf(":", first + 1);
  if (second <= first + 1) return null;
  const lineNumber = line_number_of(line.slice(first + 1, second));
  if (!lineNumber) return null;
  return { filePath: line.slice(0, first), lineNumber, content: line.slice(second + 1) };
}

function line_number_of(raw) {
  const lineNumber = Number(raw);
  if (!Number.isFinite(lineNumber) || lineNumber < 1) return null;
  return lineNumber;
}

// rg prefixes its matches with "./" while grep does not. Strip it so the same file
// yields one identity regardless of which backend produced the hit.
function workspace_path(filePath) {
  return filePath.replace(/^\.\//, "");
}

function title_for(content) {
  const trimmed = String(content || "").trim();
  if (!trimmed) return "(blank line)";
  return trimmed.length > MAX_TITLE_LENGTH ? `${trimmed.slice(0, MAX_TITLE_LENGTH - 1)}...` : trimmed;
}

function normalized_query(query) {
  return String(query || "").normalize("NFC").trim();
}

function query_length(query) {
  return Array.from(query).length;
}

function is_short_query(query) {
  if (!query) return true;
  const length = query_length(query);
  if (is_latin_query(query)) return length < MIN_LATIN_QUERY_LENGTH;
  return length < MIN_QUERY_LENGTH;
}

function is_latin_query(query) {
  return /^[\p{Script=Latin}\p{Number}_-]+$/u.test(query);
}

function expand_combinations(combinations, forms) {
  const next = [];
  for (const combination of combinations) {
    for (const form of forms) {
      next.push(`${combination}${form}`);
      if (next.length >= MAX_QUERY_VARIANTS) return next;
    }
  }
  return next;
}

function regex_min_match_length(pattern) {
  let index = 0;
  return parse_expression(false);

  function parse_expression(stopAtGroupEnd) {
    let min = parse_sequence(stopAtGroupEnd);
    while (index < pattern.length && pattern[index] === "|") {
      index += 1;
      min = Math.min(min, parse_sequence(stopAtGroupEnd));
    }
    return min;
  }

  function parse_sequence(stopAtGroupEnd) {
    let total = 0;
    while (index < pattern.length) {
      const character = pattern[index];
      if (character === "|" || (stopAtGroupEnd && character === ")")) break;
      total += apply_quantifier(parse_atom());
    }
    if (stopAtGroupEnd && pattern[index] === ")") index += 1;
    return total;
  }

  function parse_atom() {
    const character = pattern[index];
    if (character === "^" || character === "$") {
      index += 1;
      return 0;
    }
    if (character === "\\") {
      parse_escape();
      return 1;
    }
    if (character === "[") return parse_character_class();
    if (character === "(") return parse_group();
    index += 1;
    return 1;
  }

  function parse_character_class() {
    index += 1;
    while (index < pattern.length) {
      if (pattern[index] === "\\") {
        index = Math.min(pattern.length, index + 2);
      } else if (pattern[index] === "]") {
        if (pattern[index + 1] === "]") {
          index += 1;
          continue;
        }
        index += 1;
        break;
      } else {
        index += 1;
      }
    }
    return 1;
  }

  function parse_escape() {
    index = Math.min(pattern.length, index + 2);
    if ((pattern[index - 1] === "p" || pattern[index - 1] === "P") && pattern[index] === "{") {
      index += 1;
      while (index < pattern.length && pattern[index] !== "}") index += 1;
      if (pattern[index] === "}") index += 1;
    }
  }

  function parse_group() {
    index += 1;
    if (pattern[index] !== "?") return parse_expression(true);
    index += 1;
    if (pattern[index] === "=" || pattern[index] === "!" || pattern[index] === "<") {
      skip_group();
      return 0;
    }
    if (pattern[index] === ":") index += 1;
    return parse_expression(true);
  }

  function skip_group() {
    let depth = 1;
    while (index < pattern.length && depth > 0) {
      if (pattern[index] === "\\") {
        index = Math.min(pattern.length, index + 2);
      } else if (pattern[index] === "(") {
        depth += 1;
        index += 1;
      } else if (pattern[index] === ")") {
        depth -= 1;
        index += 1;
      } else {
        index += 1;
      }
    }
  }

  function apply_quantifier(atom) {
    const character = pattern[index];
    if (character === "*" || character === "?") {
      index += 1;
      return 0;
    }
    if (character === "+") {
      index += 1;
      return atom;
    }
    if (character !== "{") return atom;

    const match = pattern.slice(index).match(/^\{(\d+)(?:,(\d*)?)?\}/);
    if (!match) return atom;
    index += match[0].length;
    return atom * Number(match[1]);
  }
}
