const KEYWORDS = {
  c: "auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false NULL",
  cpp: "alignas alignof and auto bool break case catch char class const constexpr continue decltype default delete do double else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept nullptr operator or private protected public register return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while",
  js: "abstract async await break case catch class const continue debugger default delete do else enum export extends false finally for from function get if implements import in instanceof interface let new null of private protected public readonly return set static super switch this throw true try typeof undefined var void while with yield",
  ts: "abstract any as asserts async await boolean break case catch class const continue debugger declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface is keyof let namespace never new null number object of private protected public readonly return set static string super switch symbol this throw true try type typeof undefined unknown var void while yield",
  py: "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self match case",
  go: "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false iota",
  rust: "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while",
  java: "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new null package private protected public return short static strictfp super switch synchronized this throw throws transient true false try void volatile while var",
  kotlin: "abstract as break by catch class companion const continue crossinline data do dynamic else enum external false final finally for fun get if import in infix init inline inner interface internal is lateinit let lazy null object open operator out override package private protected public reified return sealed set super suspend this throw true try typealias val var vararg when where while",
  swift: "associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public rethrows static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as Any catch false is nil rethrows super self Self throw throws true try",
  php: "abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile enum extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield true false null",
  ruby: "alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield require attr_accessor attr_reader attr_writer",
  css: "important inherit initial unset none auto",
  json: "true false null",
  sql: "select from where insert update delete create table drop alter index join inner outer left right on group by order having limit offset values into set as and or not null primary key foreign references default distinct union all count sum avg min max",
  shell: "if then else elif fi for in do done while until case esac function return local export readonly declare echo exit",
};

const ALIASES = {
  jsx: "js", mjs: "js", cjs: "js", tsx: "ts", "c++": "cpp", cc: "cpp", cxx: "cpp",
  hpp: "cpp", h: "c", hh: "cpp", rb: "ruby", rs: "rust", kt: "kotlin", kts: "kotlin",
  py: "py", python: "py", golang: "go", sh: "shell", bash: "shell", zsh: "shell",
  scss: "css", less: "css", jsonc: "json", yaml: "yaml", yml: "yaml",
};

const HASH_COMMENT = new Set(["py", "ruby", "shell", "yaml"]);

export function language_for(path) {
  const name = (path || "").toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  const lang = ALIASES[ext] || ext;
  return KEYWORDS[lang] ? lang : lang === "yaml" ? "yaml" : "";
}

const keywordSets = new Map();
function keyword_set(lang) {
  if (!keywordSets.has(lang)) {
    keywordSets.set(lang, new Set((KEYWORDS[lang] || "").split(/\s+/).filter(Boolean)));
  }
  return keywordSets.get(lang);
}

function escape_html(text) {
  return text.replace(/[&<>]/g, (ch) => (ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : "&gt;"));
}

function span(cls, text) {
  return `<span class="tok-${cls}">${escape_html(text)}</span>`;
}

const TOKEN = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\b0x[0-9a-fA-F]+\b)|([A-Za-z_$][A-Za-z0-9_$]*)|([{}()[\];,.:?=+\-*/%<>!&|^~@]+)/g;

export function highlight(code, lang) {
  if (!lang || !code) return escape_html(code);
  const keywords = keyword_set(lang);
  const allowHash = HASH_COMMENT.has(lang);
  let out = "";
  let last = 0;
  let match;
  TOKEN.lastIndex = 0;
  while ((match = TOKEN.exec(code)) !== null) {
    const [text, comment, string, number, word, punct] = match;
    if (match.index > last) out += escape_html(code.slice(last, match.index));
    last = match.index + text.length;

    if (comment !== undefined) {
      if (comment[0] === "#" && !allowHash) out += escape_html(text);
      else out += span("comment", text);
    } else if (string !== undefined) {
      out += span("string", text);
    } else if (number !== undefined) {
      out += span("number", text);
    } else if (word !== undefined) {
      if (keywords.has(word)) out += span("keyword", text);
      else if (/^[A-Z]/.test(word)) out += span("type", text);
      else if (code[last] === "(") out += span("function", text);
      else out += escape_html(text);
    } else if (punct !== undefined) {
      out += span("punct", text);
    }
  }
  if (last < code.length) out += escape_html(code.slice(last));
  return out;
}
