function claim(lanes) {
  const free = lanes.indexOf(null);
  if (free !== -1) return free;
  lanes.push(null);
  return lanes.length - 1;
}

export function computeGraph(commits) {
  const lanes = [];
  const rows = [];
  for (const commit of commits) {
    let col = lanes.indexOf(commit.hash);
    const hasChild = col !== -1;
    if (!hasChild) col = claim(lanes);
    const joins = [];
    for (let i = 0; i < lanes.length; i += 1) {
      if (i !== col && lanes[i] === commit.hash) {
        joins.push(i);
        lanes[i] = null;
      }
    }
    const before = lanes.slice();
    const edges = [];
    const [first, ...rest] = commit.parents ?? [];
    lanes[col] = null;
    if (first) {
      const existing = lanes.indexOf(first);
      if (existing !== -1 && existing < col) edges.push(existing);
      else {
        lanes[col] = first;
        edges.push(col);
      }
    }
    for (const parent of rest) {
      let target = lanes.indexOf(parent);
      if (target === -1) {
        target = claim(lanes);
        lanes[target] = parent;
      }
      edges.push(target);
    }
    const pass = [];
    for (let i = 0; i < before.length; i += 1) if (i !== col && before[i] !== null) pass.push(i);
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    const width = Math.max(col + 1, before.length, lanes.length, ...edges.map((e) => e + 1), ...joins.map((j) => j + 1));
    rows.push({ commit, col, hasChild, joins, pass, edges, width });
  }
  return rows;
}
