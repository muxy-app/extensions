// Which tree-sitter grammar (if any) highlights a file. Tiny on purpose: the
// grammars, queries, and runtime in ./tree-sitter.js load only on a match.

import { extname } from "@/shared/paths";

const GRAMMAR_BY_EXT = {
  ".js": "javascript",
  ".cjs": "javascript",
  ".mjs": "javascript",
  ".jsx": "javascript",
  ".ts": "typescript",
  ".cts": "typescript",
  ".mts": "typescript",
  ".tsx": "tsx",
  ".py": "python",
  ".pyw": "python",
  ".pyi": "python",
  ".go": "go",
  ".rs": "rust",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".c": "cpp",
  ".h": "cpp",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".java": "java",
  ".rb": "ruby",
  ".lua": "lua",
  ".toml": "toml",
  ".zig": "zig",
  ".zon": "zig",
  ".php": "php",
  ".phtml": "php",
};

export function grammar_for(path) {
  return GRAMMAR_BY_EXT[extname(path)] ?? null;
}
