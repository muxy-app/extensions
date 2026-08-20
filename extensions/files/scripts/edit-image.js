// Palette command: pick an image anywhere in the workspace and open it straight
// in the photo editor. Mirrors scripts/quick-open.js, filtered to raster images.
const SKIP_DIRS = [".git", "node_modules", ".svn", ".hg"];
const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".avif", ".apng"];
const MAX_FILES = 20000;
const ENUM_TIMEOUT_SECS = 1;
const INITIAL_LIMIT = 500;
const MAX_RESULTS = 200;

function basename(path) {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

function is_image(path) {
  const name = path.toLowerCase();
  for (const ext of IMAGE_EXT) {
    if (name.endsWith(ext)) return true;
  }
  return false;
}

function to_item(rel) {
  return { id: rel, title: basename(rel), subtitle: rel };
}

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
    const path = rel.replace(/^\.\//, "").replace(/\/+$/, "");
    if (path && is_image(path)) files.push(path);
    if (files.length >= MAX_FILES) break;
  }
  return files.length ? files : null;
}

function git_images() {
  return timed_lines(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], "\0");
}

function find_images() {
  const argv = ["find", ".", "-type", "f"];
  for (const dir of SKIP_DIRS) {
    argv.push("-not", "-path", `*/${dir}/*`);
  }
  return timed_lines(argv, "\n") || [];
}

let index = null;
function images() {
  if (index === null) index = git_images() || find_images();
  return index;
}

function search(query) {
  const needle = query.toLowerCase();
  const matches = [];
  for (const rel of images()) {
    const idx = rel.toLowerCase().indexOf(needle);
    if (idx >= 0) matches.push({ rel, score: idx });
  }
  matches.sort((a, b) => a.score - b.score || a.rel.length - b.rel.length);
  return matches.slice(0, MAX_RESULTS).map((match) => to_item(match.rel));
}

muxy.modal.open({
  placeholder: "Edit image…",
  emptyLabel: "No images in this workspace",
  noMatchLabel: "No matching images",
  items(emit) {
    emit(images().slice(0, INITIAL_LIMIT).map(to_item));
  },
  onQuery(query) {
    if (!query) return images().slice(0, INITIAL_LIMIT).map(to_item);
    return search(query);
  },
  onSelect(choice) {
    if (!choice) return;
    const extId = (typeof muxy !== "undefined" && muxy.extensionID) || "files";
    try {
      muxy.tabs.open({
        kind: "extensionWebView",
        extension: {
          id: extId,
          tabType: "code-editor",
          singleton: false,
          data: { filePath: choice.id, replaceable: false, photo: true },
        },
      });
    } catch (err) {
      console.error("[edit-image] tabs.open failed: " + String((err && err.message) || err));
    }
  },
});
