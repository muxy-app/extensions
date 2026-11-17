// Line diff for the git gutter: Myers' O((N+M)·D) algorithm over interned
// lines, after trimming the common prefix and suffix. Cost tracks the size of
// the change, not the size of the file, so a few edits in a large file stay
// cheap. Very different texts (D > MAX_EDIT) are reported as skipped.

const MAX_EDIT = 2000;

export function split_lines(text) {
  return text === "" ? [] : text.split(/\r\n|\r|\n/);
}

function strip_final_empty(lines) {
  return lines.length > 0 && lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
}

/**
 * Shortest edit script between `a` and `b` (arrays of ints) as hunks
 * `{ aStart, aLen, bStart, bLen }`, or null when it exceeds `maxEdit`.
 */
function myers(a, b, maxEdit) {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, maxEdit);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace = [];
  let found = -1;
  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    if (found >= 0) break;
  }
  if (found < 0) return null;

  // Walk the trace backwards, collecting single-line edits, then merge them.
  const edits = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d -= 1) {
    const prev = trace[d];
    const at = (k) => prev[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
    }
    if (x === prevX) edits.push({ type: "add", a: x, b: prevY });
    else edits.push({ type: "del", a: prevX, b: y });
    x = prevX;
    y = prevY;
  }
  edits.reverse();

  const hunks = [];
  for (const edit of edits) {
    const last = hunks[hunks.length - 1];
    const aPos = edit.a;
    const bPos = edit.b;
    if (last && last.aStart + last.aLen === aPos && last.bStart + last.bLen === bPos) {
      if (edit.type === "add") last.bLen += 1;
      else last.aLen += 1;
    } else {
      hunks.push({ aStart: aPos, aLen: edit.type === "del" ? 1 : 0, bStart: bPos, bLen: edit.type === "add" ? 1 : 0 });
    }
  }
  return hunks;
}

/**
 * Compares baseline lines with current lines. Returns
 * `{ changed: Map<lineIndex, "added"|"modified">, removedBefore: Set<lineIndex>,
 *    removedAtEnd, skipped? }` with 0-based indexes into `current`.
 */
export function diff_line_arrays(baseLines, currentLines) {
  const changed = new Map();
  const removedBefore = new Set();
  const oldLines = strip_final_empty(baseLines);
  const newLines = strip_final_empty(currentLines);

  let prefix = 0;
  const maxPrefix = Math.min(oldLines.length, newLines.length);
  while (prefix < maxPrefix && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let suffix = 0;
  const maxSuffix = maxPrefix - prefix;
  while (
    suffix < maxSuffix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const ids = new Map();
  const intern = (line) => {
    let id = ids.get(line);
    if (id === undefined) {
      id = ids.size;
      ids.set(line, id);
    }
    return id;
  };
  const a = new Int32Array(oldLines.length - prefix - suffix);
  for (let i = 0; i < a.length; i += 1) a[i] = intern(oldLines[prefix + i]);
  const b = new Int32Array(newLines.length - prefix - suffix);
  for (let i = 0; i < b.length; i += 1) b[i] = intern(newLines[prefix + i]);

  if (a.length > 0 || b.length > 0) {
    const hunks = myers(a, b, MAX_EDIT);
    if (!hunks) return { changed, removedBefore, removedAtEnd: false, skipped: true };
    for (const hunk of hunks) {
      const start = prefix + hunk.bStart;
      if (hunk.bLen > 0) {
        const kind = hunk.aLen > 0 ? "modified" : "added";
        for (let i = 0; i < hunk.bLen; i += 1) changed.set(start + i, kind);
      } else if (hunk.aLen > 0) {
        removedBefore.add(start);
      }
    }
  }

  const removedAtEnd = removedBefore.has(newLines.length);
  removedBefore.delete(newLines.length);
  return { changed, removedBefore, removedAtEnd };
}

export function diff_lines(baseline, current) {
  if (baseline === current) return { changed: new Map(), removedBefore: new Set(), removedAtEnd: false };
  return diff_line_arrays(split_lines(baseline), split_lines(current));
}
