const MAX_DIFF_LINES = 6000;

function split_lines(text) {
  if (text === "") return [];
  return text.split("\n");
}

function common_prefix(a, b) {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i += 1;
  return i;
}

function common_suffix(a, b, prefix) {
  const max = Math.min(a.length, b.length) - prefix;
  let i = 0;
  while (i < max && a[a.length - 1 - i] === b[b.length - 1 - i]) i += 1;
  return i;
}

function lcs_table(a, b) {
  const cols = b.length + 1;
  const table = new Uint32Array((a.length + 1) * cols);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const here = i * cols + j;
      if (a[i] === b[j]) table[here] = table[(i + 1) * cols + (j + 1)] + 1;
      else table[here] = Math.max(table[(i + 1) * cols + j], table[i * cols + (j + 1)]);
    }
  }
  return { table, cols };
}

function record_block(block, changed, removedBefore) {
  if (block.added > 0) {
    const kind = block.removed > 0 ? "modified" : "added";
    for (let k = 0; k < block.added; k += 1) changed.set(block.newStart + k, kind);
  } else if (block.removed > 0) {
    removedBefore.add(block.newStart);
  }
  block.added = 0;
  block.removed = 0;
}

function diff_middle(oldLines, newLines, offset, changed, removedBefore) {
  const { table, cols } = lcs_table(oldLines, newLines);
  const block = { added: 0, removed: 0, newStart: offset };
  let i = 0;
  let j = 0;

  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      record_block(block, changed, removedBefore);
      i += 1;
      j += 1;
      block.newStart = offset + j;
      continue;
    }
    if (block.added === 0 && block.removed === 0) block.newStart = offset + j;
    if (table[(i + 1) * cols + j] >= table[i * cols + (j + 1)]) {
      block.removed += 1;
      i += 1;
    } else {
      block.added += 1;
      j += 1;
    }
  }
  if (block.added === 0 && block.removed === 0) block.newStart = offset + j;
  block.removed += oldLines.length - i;
  block.added += newLines.length - j;
  record_block(block, changed, removedBefore);
}

function strip_final_newline(text) {
  if (text.endsWith("\r\n")) return text.slice(0, -2);
  if (text.endsWith("\n")) return text.slice(0, -1);
  return text;
}

export function diff_lines(baseline, current) {
  const changed = new Map();
  const removedBefore = new Set();
  if (baseline === current) return { changed, removedBefore, removedAtEnd: false };

  baseline = strip_final_newline(baseline);
  current = strip_final_newline(current);
  if (baseline === current) return { changed, removedBefore, removedAtEnd: false };

  const oldLines = split_lines(baseline);
  const newLines = split_lines(current);

  if (oldLines.length + newLines.length > MAX_DIFF_LINES) {
    return { changed, removedBefore, removedAtEnd: false, skipped: true };
  }

  const prefix = common_prefix(oldLines, newLines);
  const suffix = common_suffix(oldLines, newLines, prefix);
  const oldMiddle = oldLines.slice(prefix, oldLines.length - suffix);
  const newMiddle = newLines.slice(prefix, newLines.length - suffix);

  if (oldMiddle.length > 0 || newMiddle.length > 0) {
    diff_middle(oldMiddle, newMiddle, prefix, changed, removedBefore);
  }

  const removedAtEnd = removedBefore.has(newLines.length);
  removedBefore.delete(newLines.length);
  return { changed, removedBefore, removedAtEnd };
}
