const SVG_NS = "http://www.w3.org/2000/svg";
export const COL = 12;
export const MAX_COLS = 8;

const x = (col) => COL / 2 + Math.min(col, MAX_COLS - 1) * COL;
const color = (col) => `var(--lane-${col % 6})`;

function el(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function line(x1, y1, x2, y2, col) {
  return el("path", { d: x1 === x2 ? `M${x1} ${y1}V${y2}` : `M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`, stroke: color(col) });
}

export function rail(row, height, { outgoing = false, dim = false } = {}) {
  const cols = Math.min(MAX_COLS, Math.max(1, row.width));
  const width = cols * COL;
  const mid = height / 2;
  const svg = el("svg", { width, height, viewBox: `0 0 ${width} ${height}`, class: "rail", fill: "none", "stroke-width": 1.5, "aria-hidden": "true" });
  const cx = x(row.col);
  for (const col of row.pass) if (col < MAX_COLS) svg.appendChild(line(x(col), 0, x(col), height, col));
  if (row.hasChild) svg.appendChild(line(cx, 0, cx, mid, row.col));
  for (const col of row.joins) if (col < MAX_COLS) svg.appendChild(line(x(col), 0, cx, mid, col));
  for (const col of row.edges) if (col < MAX_COLS) svg.appendChild(line(cx, mid, x(col), height, col));
  const merge = row.commit.parents.length > 1;
  svg.appendChild(
    el("circle", {
      cx,
      cy: mid,
      r: merge ? 3 : 3.5,
      fill: outgoing || merge ? color(row.col) : "var(--muxy-background)",
      stroke: color(row.col),
      "stroke-width": 1.5,
      opacity: dim ? 0.6 : 1,
    }),
  );
  return svg;
}
