// Files: Go to File… (cmd+p). A runScript command: `muxy.*` calls here are
// synchronous. Bundled to dist/scripts/quick-open.js by copy-build-assets.mjs.

import { FileIndex, MAX_RESULTS } from "./quick-open/search.js";
import { open_editor } from "./lib/open-editor.js";

const SKIP_DIRS = [".git", "node_modules", ".svn", ".hg"];
const MAX_FILES = 50000;
const ENUM_TIMEOUT_SECS = 1;
const INITIAL_LIMIT = 1000;

function to_item(rel) {
  const slash = rel.lastIndexOf("/");
  return { id: rel, title: rel.slice(slash + 1), subtitle: slash === -1 ? null : rel.slice(0, slash) };
}

// Runs argv under a hard timeout so a huge or slow tree can't hang the picker.
const TIMEOUT_PERL =
  '$SIG{ALRM}=sub{kill "KILL",-$p if $p;exit};' +
  "$p=fork();if(!$p){setpgrp(0,0);exec @ARGV or exit}" +
  `alarm ${ENUM_TIMEOUT_SECS};waitpid($p,0);`;

function timed_lines(argv, sep) {
  let out = "";
  try {
    const result = muxy.exec(["perl", "-e", TIMEOUT_PERL, "--", ...argv]);
    out = (result && result.stdout) || "";
  } catch {
    return null;
  }
  if (!out) return null;
  const files = [];
  for (const rel of out.split(sep)) {
    if (rel) files.push(rel.replace(/^\.\//, "").replace(/\/+$/, ""));
    if (files.length >= MAX_FILES) break;
  }
  return files.length ? files : null;
}

function list_files() {
  const tracked = timed_lines(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], "\0");
  if (tracked) return tracked;
  const argv = ["find", ".", "-type", "f"];
  for (const dir of SKIP_DIRS) argv.push("-not", "-path", `*/${dir}/*`);
  return timed_lines(argv, "\n") || [];
}

let index = null;
function file_index() {
  if (index === null) index = new FileIndex(list_files());
  return index;
}

muxy.modal.open({
  placeholder: "Go to file…",
  emptyLabel: "No files",
  noMatchLabel: "No matching files",
  items(emit) {
    emit(file_index().paths.slice(0, INITIAL_LIMIT).map(to_item));
  },
  onQuery(query) {
    const files = file_index();
    if (!query.trim()) return files.paths.slice(0, INITIAL_LIMIT).map(to_item);
    return files.search(query, MAX_RESULTS).map(to_item);
  },
  onSelect(choice) {
    if (!choice) return;
    try {
      open_editor(choice.id);
    } catch (err) {
      console.error(`[quick-open] could not open ${choice.id}: ${(err && err.message) || err}`);
    }
  },
});
