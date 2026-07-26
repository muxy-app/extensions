const MAX_RESULTS = 2000;
const MAX_TEXT_LEN = 200;

function ext_id() {
  return (typeof muxy !== "undefined" && muxy.extensionID) || "files";
}

function rg_args(query, options) {
  const args = ["rg", "-n", "--null", "--no-config", "--color", "never"];
  if (!options.regex) args.push("-F");
  if (!options.caseSensitive) args.push("-i");
  if (options.wholeWord) args.push("-w");
  args.push("-e", query, ".");
  return args;
}

function grep_args(query, options) {
  const args = ["grep", "-rn", "--color=never", "--exclude-dir=node_modules", "--exclude-dir=.git"];
  if (options.regex) args.push("-E");
  else args.push("-F");
  if (!options.caseSensitive) args.push("-i");
  if (options.wholeWord) args.push("-w");
  args.push("-e", query, ".");
  return args;
}

function clip_around(text, query) {
  if (text.length <= MAX_TEXT_LEN) return text;
  let hit = -1;
  if (query) hit = text.toLowerCase().indexOf(query.toLowerCase());
  if (hit < 0) return text.slice(0, MAX_TEXT_LEN) + "…";
  const pad = Math.floor((MAX_TEXT_LEN - Math.min(query.length, MAX_TEXT_LEN)) / 2);
  let from = Math.max(0, hit - pad);
  let to = Math.min(text.length, from + MAX_TEXT_LEN);
  from = Math.max(0, to - MAX_TEXT_LEN);
  return (from > 0 ? "…" : "") + text.slice(from, to) + (to < text.length ? "…" : "");
}

function split_line(line) {
  const nul = line.indexOf("\0");
  if (nul >= 0) {
    // ripgrep --null: path is NUL-delimited (may itself contain colons),
    // then "line:text" with line as leading digits.
    const path = line.slice(0, nul);
    const rest = line.slice(nul + 1);
    const colon = rest.indexOf(":");
    if (colon < 0) return null;
    return { path, num: rest.slice(0, colon), text: rest.slice(colon + 1) };
  }
  // grep fallback: "path:line:text"; split on the first colon (paths with a
  // colon are rarer than lines whose text begins with digits+colon).
  const m = /^(.+?):(\d+):/.exec(line);
  if (!m) return null;
  return { path: m[1], num: m[2], text: line.slice(m[0].length) };
}

function parse_line(line, query, options) {
  const parts = split_line(line);
  if (!parts) return null;
  const file_path = parts.path.replace(/^\.\//, "");
  const line_num = parseInt(parts.num, 10);
  if (!file_path || !Number.isFinite(line_num)) return null;
  const text = clip_around(parts.text, options && options.regex ? "" : query);
  const loc = `${file_path}:${line_num}`;
  return {
    id: loc,
    title: text.trim() || " ",
    subtitle: options && options.regex ? `${loc} · ${query}` : loc,
  };
}

function parse_choice(id) {
  if (typeof id !== "string") return null;
  const m = /^(.+):(\d+)$/.exec(id);
  if (!m) return null;
  const file_path = m[1];
  const line_num = parseInt(m[2], 10);
  if (!file_path || !Number.isFinite(line_num)) return null;
  return { filePath: file_path, lineNum: line_num };
}

function run_search(query, options) {
  let result = null;
  try {
    result = muxy.exec(rg_args(query, options));
  } catch {
    result = null;
  }

  if (!result || result.exitCode > 1) {
    try {
      result = muxy.exec(grep_args(query, options));
    } catch {
      return { stdout: "", error: true };
    }
  }

  const error = !result || result.exitCode > 1;
  return { stdout: (result && result.stdout) || "", error };
}

function search(query, options) {
  const { stdout, error } = run_search(query, options);
  if (error) {
    const label = options.regex ? "Invalid pattern" : "Search failed";
    return [{ id: "__error__", title: label, subtitle: query }];
  }
  if (!stdout) return [];

  const items = [];
  let start = 0;
  while (start < stdout.length && items.length < MAX_RESULTS) {
    const nl = stdout.indexOf("\n", start);
    const raw = nl === -1 ? stdout.slice(start) : stdout.slice(start, nl);
    const item = raw.trim() ? parse_line(raw, query, options) : null;
    if (item) items.push(item);
    if (nl === -1) break;
    start = nl + 1;
  }
  return items;
}

muxy.modal.open({
  placeholder: "Find in files…",
  emptyLabel: "Type to search",
  noMatchLabel: "No results",
  searchToolbar: true,
  onQuery(query, _emit, options) {
    if (!query) return [];
    return search(query, options || {});
  },
  onSelect(choice) {
    if (!choice || choice.id === "__error__") return;
    const target = parse_choice(choice.id);
    if (!target) return;
    try {
      muxy.tabs.open({
        kind: "extensionWebView",
        extension: {
          id: ext_id(),
          tabType: "code-editor",
          singleton: false,
          data: { filePath: target.filePath, line: target.lineNum, replaceable: false },
        },
      });
    } catch (err) {
      console.error(
        "[find-in-files] tabs.open FAILED" +
          " file=" + String(target.filePath) +
          " line=" + String(target.lineNum) +
          " error=" + String((err && err.message) || err),
      );
    }
  },
});
