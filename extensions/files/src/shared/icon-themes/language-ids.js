// VS Code icon themes can map a *language* (languageIds) instead of an
// extension. VS Code knows each file's language from its language
// contributions; Muxy doesn't, so this table reproduces the built-in ones and
// the popular extension languages icon themes target. Only consulted after a
// theme's own fileNames and fileExtensions miss.

const BY_EXT = {
  // JavaScript / TypeScript
  js: "javascript", cjs: "javascript", mjs: "javascript", es6: "javascript", pac: "javascript",
  jsx: "javascriptreact",
  ts: "typescript", cts: "typescript", mts: "typescript",
  tsx: "typescriptreact",
  // Web
  html: "html", htm: "html", shtml: "html", xhtml: "html", mdoc: "html", jshtm: "html",
  css: "css", scss: "scss", sass: "sass", less: "less", styl: "stylus", pcss: "postcss", postcss: "postcss",
  vue: "vue", svelte: "svelte", astro: "astro", pug: "jade", jade: "jade", haml: "haml", slim: "slim",
  hbs: "handlebars", handlebars: "handlebars", twig: "twig", liquid: "liquid", njk: "nunjucks", nunjucks: "nunjucks",
  mjml: "mjml", cshtml: "razor", razor: "aspnetcorerazor", jsp: "jsp", cfm: "lang-cfml", cfc: "lang-cfml",
  // Data / config
  json: "json", webmanifest: "json", map: "json", har: "json", jsonc: "jsonc", "code-workspace": "jsonc",
  json5: "json5", jsonl: "jsonl", ndjson: "jsonl", hjson: "hjson",
  yaml: "yaml", yml: "yaml", toml: "toml", ini: "ini", cfg: "ini", conf: "ini", properties: "properties",
  xml: "xml", xsd: "xml", xaml: "xml", plist: "xml", csproj: "xml", fsproj: "xml", vbproj: "xml", svg: "svg",
  xsl: "xsl", xslt: "xsl", csv: "csv", tsv: "tsv", psv: "psv", env: "dotenv",
  graphql: "graphql", gql: "graphql", proto: "proto", prisma: "prisma",
  hcl: "hcl", tf: "terraform", tfvars: "terraform", tofu: "opentofu", nix: "nix", cue: "cue", dhall: "dhall",
  // Docs
  md: "markdown", markdown: "markdown", mdown: "markdown", mkd: "markdown", mkdn: "markdown", mdx: "markdown",
  markdoc: "markdoc", rst: "restructuredtext", adoc: "asciidoc", asciidoc: "asciidoc",
  tex: "latex", ltx: "latex", latex: "latex", cls: "latex-class", sty: "latex-package", dtx: "doctex",
  bib: "bibtex", bst: "bibtex-style", typ: "typst", txt: "plaintext", log: "log", pdf: "pdf",
  ipynb: "jupyter", rmd: "rsweave",
  // Systems
  c: "c", i: "c", h: "c",
  cpp: "cpp", cc: "cpp", cxx: "cpp", "c++": "cpp", hpp: "cpp", hh: "cpp", hxx: "cpp", "h++": "cpp", ino: "cpp", ipp: "cpp", tpp: "cpp",
  cu: "cuda-cpp", cuh: "cuda-cpp", m: "objective-c", mm: "objective-cpp",
  cs: "csharp", csx: "csharp", cake: "cake", fs: "fsharp", fsi: "fsharp", fsx: "fsharp", vb: "vb",
  go: "go", rs: "rust", zig: "zig", d: "d", nim: "nim", nimble: "nimble", v: "v", vala: "vala", c3: "c3", odin: "odin",
  swift: "swift", java: "java", kt: "kotlin", kts: "kotlin", scala: "scala", sc: "scala", groovy: "groovy", gradle: "groovy",
  dart: "dart", hx: "haxe", hxml: "hxml", mojo: "mojo", "🔥": "mojo",
  // Scripting
  py: "python", pyi: "python", pyw: "python", rpy: "python", gyp: "python", gypi: "python",
  rb: "ruby", rbx: "ruby", rjs: "ruby", gemspec: "ruby", rake: "ruby", ru: "ruby", erb: "erb",
  php: "php", php3: "php", php4: "php", php5: "php", phtml: "php", ctp: "php",
  pl: "perl", pm: "perl", pod: "perl", t: "perl", psgi: "perl", raku: "raku", rakumod: "raku", p6: "perl6",
  lua: "lua", luau: "luau", r: "r", rhistory: "r", rprofile: "r", jl: "julia",
  sh: "shellscript", bash: "shellscript", zsh: "shellscript", ksh: "shellscript", fish: "fish", ebuild: "shellscript",
  ps1: "powershell", psm1: "powershell", psd1: "powershell", pssc: "powershell", psrc: "powershell",
  bat: "bat", cmd: "bat", awk: "awk", tcl: "tcl", applescript: "applescript", scpt: "applescript",
  ahk: "ahk", ahk2: "ahk2", au3: "autoit",
  coffee: "coffeescript", cson: "coffeescript", iced: "coffeescript", ls: "livescript",
  // Functional
  hs: "haskell", lhs: "haskell", elm: "elm", ex: "elixir", exs: "elixir", erl: "erlang", hrl: "erlang", gleam: "gleam",
  clj: "clojure", cljc: "clojure", edn: "clojure", cljs: "clojurescript", ml: "ocaml", mli: "ocaml",
  re: "reason", rei: "reason", res: "rescript", resi: "rescript", purs: "purescript", idr: "idris", lean: "lean",
  sml: "sml", sig: "sml", rkt: "racket", scm: "scheme", lisp: "lisp", el: "lisp", pro: "prolog",
  // Shaders / graphics
  glsl: "glsl", vert: "glsl", frag: "glsl", geom: "glsl", comp: "glsl", hlsl: "hlsl", fx: "hlsl",
  wgsl: "wgsl", shader: "shaderlab", gdshader: "gdshader", gd: "gdscript", tres: "gdresource", tscn: "gdresource",
  // Misc
  sql: "sql", dsql: "sql", kql: "kql", diff: "diff", patch: "diff", rej: "diff",
  dockerfile: "dockerfile", containerfile: "dockerfile", makefile: "makefile", mk: "makefile", mak: "makefile",
  cmake: "cmake", sol: "solidity", huff: "huff", cairo: "cairo", cds: "cds", apex: "apex", cls_apex: "apex",
  feature: "cucumber", robot: "robotframework", pgn: "pgn", wat: "wat", wast: "wat", f: "fortran", f90: "fortran", for: "fortran",
  cob: "cobol", cbl: "cobol", sas: "sas", matlab: "matlab", nb: "wolfram", wl: "wolfram", wls: "wolfram",
  pp: "puppet", tw: "twee3", twee: "twee3", sp: "pawn", pwn: "pawn", inc: "pawn", qs: "qsharp", slint: "slint",
  mcfunction: "mcfunction", vim: "viml", vimrc: "viml", gp: "gnuplot", plt: "gnuplot", nginxconf: "nginx",
  bicep: "bicep", yang: "yang", xq: "xquery", xquery: "xquery", xqy: "xquery", beancount: "beancount", hack: "hack",
  tl: "teal", lol: "lolcode", red: "red", reds: "red", riot: "riot", stylable: "stylable", st: "stylable",
};

const BY_NAME = {
  dockerfile: "dockerfile", containerfile: "dockerfile",
  "docker-compose.yml": "dockercompose", "docker-compose.yaml": "dockercompose",
  "compose.yml": "dockercompose", "compose.yaml": "dockercompose", "docker-bake.hcl": "dockerbake",
  makefile: "makefile", gnumakefile: "makefile", "cmakelists.txt": "cmake", "cmakecache.txt": "cmake-cache",
  ".gitignore": "ignore", ".gitattributes": "git", ".gitmodules": "git", ".gitconfig": "git",
  ".npmignore": "ignore", ".dockerignore": "ignore", ".eslintignore": "ignore", ".prettierignore": "ignore",
  commit_editmsg: "git-commit", merge_msg: "git-commit", "git-rebase-todo": "git-rebase",
  ".env": "dotenv", ".editorconfig": "editorconfig", hosts: "hosts", ssh_config: "ssh_config", sshd_config: "ssh_config",
  "requirements.txt": "pip-requirements", "constraints.txt": "pip-requirements",
  gemfile: "ruby", rakefile: "ruby", podfile: "ruby", vagrantfile: "ruby", brewfile: "ruby", guardfile: "ruby",
  jenkinsfile: "groovy", "build.gradle": "gradle-build", "settings.gradle": "gradle-build", "build.gradle.kts": "gradle-kotlin-dsl",
  ".bashrc": "shellscript", ".bash_profile": "shellscript", ".bash_aliases": "shellscript", ".zshrc": "shellscript",
  ".zprofile": "shellscript", ".zshenv": "shellscript", ".profile": "shellscript", pkgbuild: "shellscript", apkbuild: "shellscript",
  ".vimrc": "viml", "_vimrc": "viml", "nginx.conf": "nginx", "tsconfig.json": "jsonc", "jsconfig.json": "jsonc",
  ".babelrc": "json", ".eslintrc": "jsonc", ".prettierrc": "json", "azure-pipelines.yml": "azure-pipelines",
  "xmake.lua": "xmake", "go.mod": "go.mod", "go.sum": "go.sum", "go.work": "go.work",
};

/** The VS Code language ID of a file, or null. `name` must be lowercase. */
export function language_id(name) {
  if (name in BY_NAME) return BY_NAME[name];
  if (name.startsWith(".env.")) return "dotenv";
  if (name.startsWith("dockerfile.") || name.endsWith(".dockerfile")) return "dockerfile";
  for (let dot = name.indexOf("."); dot !== -1; dot = name.indexOf(".", dot + 1)) {
    const ext = name.slice(dot + 1);
    if (ext in BY_EXT) return BY_EXT[ext];
  }
  return null;
}
