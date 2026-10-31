const FILE_HEADER = /^diff --(git|cc|combined) /m;

export function splitCombined(patch) {
  const text = String(patch ?? "");
  const kept = [];
  const combined = [];
  const starts = [];
  const re = /^diff --(git|cc|combined) (.*)$/gm;
  let match;
  while ((match = re.exec(text))) starts.push({ index: match.index, kind: match[1], rest: match[2] });
  if (!starts.length) return { patch: text.trim() ? text : "", combined };
  for (let i = 0; i < starts.length; i += 1) {
    const chunk = text.slice(starts[i].index, starts[i + 1]?.index ?? text.length);
    if (starts[i].kind === "git") kept.push(chunk);
    else combined.push(starts[i].rest.trim());
  }
  return { patch: kept.join(""), combined };
}

export function hasFiles(patch) {
  return FILE_HEADER.test(String(patch ?? ""));
}

export function untrackedPatch(path, content) {
  const text = String(content ?? "");
  const header = `diff --git a/${path} b/${path}\nnew file mode 100644\n`;
  if (!text) return header;
  const endsWithNewline = text.endsWith("\n");
  const lines = (endsWithNewline ? text.slice(0, -1) : text).split("\n");
  const body = lines.map((line) => `+${line}`).join("\n");
  return `${header}--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${body}\n${endsWithNewline ? "" : "\\ No newline at end of file\n"}`;
}

export function binaryPatch(path) {
  return `diff --git a/${path} b/${path}\nnew file mode 100644\nBinary files /dev/null and b/${path} differ\n`;
}

export function looksBinary(text) {
  return String(text ?? "").slice(0, 8000).includes("\u0000");
}
