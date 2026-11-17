// Rewrites the source behind the preview's task-list checkboxes. Kept free of
// DOM and app imports so it can be unit-tested in Node.

const TASK_MARKER_RE = /^((?:\s*>)*\s*(?:[-*+]|\d{1,9}[.)])\s+\[)( |x|X)(\]\s+)/;
const FENCE_RE = /^(?:\s*>)*\s*```/;

// Flip the Nth task-list marker in `source` to `checked`, scanning lines in the
// same top-to-bottom order the renderer assigns checkbox indices (fenced code is
// skipped, as the renderer never draws checkboxes there). Returns the updated
// source, or null when the index has no matching marker.
export function toggle_task_in_source(source, index, checked) {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  let count = 0;
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (FENCE_RE.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = TASK_MARKER_RE.exec(lines[i]);
    if (!match) continue;
    if (count === index) {
      lines[i] = lines[i].replace(TASK_MARKER_RE, `$1${checked ? "x" : " "}$3`);
      return lines.join(newline);
    }
    count += 1;
  }
  return null;
}
