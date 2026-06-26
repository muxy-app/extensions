import coreWasm from "web-tree-sitter/web-tree-sitter.wasm?url";
import jsWasm from "tree-sitter-javascript/tree-sitter-javascript.wasm?url";
import tsWasm from "tree-sitter-typescript/tree-sitter-typescript.wasm?url";
import tsxWasm from "tree-sitter-typescript/tree-sitter-tsx.wasm?url";
import pythonWasm from "tree-sitter-python/tree-sitter-python.wasm?url";
import goWasm from "tree-sitter-go/tree-sitter-go.wasm?url";
import rustWasm from "tree-sitter-rust/tree-sitter-rust.wasm?url";
import bashWasm from "tree-sitter-bash/tree-sitter-bash.wasm?url";
import cppWasm from "tree-sitter-cpp/tree-sitter-cpp.wasm?url";
import javaWasm from "tree-sitter-java/tree-sitter-java.wasm?url";
import rubyWasm from "tree-sitter-ruby/tree-sitter-ruby.wasm?url";
import luaWasm from "@tree-sitter-grammars/tree-sitter-lua/tree-sitter-lua.wasm?url";
import tomlWasm from "@tree-sitter-grammars/tree-sitter-toml/tree-sitter-toml.wasm?url";
import zigWasm from "@tree-sitter-grammars/tree-sitter-zig/tree-sitter-zig.wasm?url";
import phpWasm from "tree-sitter-php/tree-sitter-php.wasm?url";
import jsHighlights from "tree-sitter-javascript/queries/highlights.scm?raw";
import jsxHighlights from "tree-sitter-javascript/queries/highlights-jsx.scm?raw";
import jsParamsHighlights from "tree-sitter-javascript/queries/highlights-params.scm?raw";
import tsHighlights from "tree-sitter-typescript/queries/highlights.scm?raw";
import pythonHighlights from "tree-sitter-python/queries/highlights.scm?raw";
import goHighlights from "tree-sitter-go/queries/highlights.scm?raw";
import rustHighlights from "tree-sitter-rust/queries/highlights.scm?raw";
import bashHighlights from "tree-sitter-bash/queries/highlights.scm?raw";
import cHighlights from "tree-sitter-c/queries/highlights.scm?raw";
import cppHighlights from "tree-sitter-cpp/queries/highlights.scm?raw";
import javaHighlights from "tree-sitter-java/queries/highlights.scm?raw";
import rubyHighlights from "tree-sitter-ruby/queries/highlights.scm?raw";
import luaHighlights from "@tree-sitter-grammars/tree-sitter-lua/queries/highlights.scm?raw";
import tomlHighlights from "@tree-sitter-grammars/tree-sitter-toml/queries/highlights.scm?raw";
import zigHighlights from "@tree-sitter-grammars/tree-sitter-zig/queries/highlights.scm?raw";
import phpHighlights from "tree-sitter-php/queries/highlights.scm?raw";
import { extname } from "@/lib/files";

const GRAMMARS = {
  javascript: { wasm: jsWasm, highlights: [jsHighlights, jsxHighlights, jsParamsHighlights] },
  typescript: { wasm: tsWasm, highlights: [jsHighlights, tsHighlights] },
  tsx: { wasm: tsxWasm, highlights: [jsHighlights, jsxHighlights, tsHighlights] },
  python: { wasm: pythonWasm, highlights: [pythonHighlights] },
  go: { wasm: goWasm, highlights: [goHighlights] },
  rust: { wasm: rustWasm, highlights: [rustHighlights] },
  bash: { wasm: bashWasm, highlights: [bashHighlights] },
  cpp: { wasm: cppWasm, highlights: [cHighlights, cppHighlights] },
  java: { wasm: javaWasm, highlights: [javaHighlights] },
  ruby: { wasm: rubyWasm, highlights: [rubyHighlights] },
  lua: { wasm: luaWasm, highlights: [luaHighlights] },
  toml: { wasm: tomlWasm, highlights: [tomlHighlights] },
  zig: { wasm: zigWasm, highlights: [zigHighlights] },
  php: { wasm: phpWasm, highlights: [phpHighlights] },
};

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

let runtime = null;
const loaded = new Map();

function load_runtime() {
  runtime ??= import("web-tree-sitter").then(async (mod) => {
    await mod.Parser.init({ locateFile: () => coreWasm });
    return mod;
  });
  return runtime;
}

function load_grammar(name) {
  if (!loaded.has(name)) {
    loaded.set(
      name,
      (async () => {
        const { Parser, Language, Query } = await load_runtime();
        const grammar = GRAMMARS[name];
        const language = await Language.load(grammar.wasm);
        return { Parser, language, query: new Query(language, grammar.highlights.join("\n")) };
      })(),
    );
  }
  return loaded.get(name);
}

export function tree_sitter_for(path) {
  const name = GRAMMAR_BY_EXT[extname(path)];
  return name ? load_grammar(name) : Promise.resolve(null);
}
