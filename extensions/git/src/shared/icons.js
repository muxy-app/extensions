const SVG_NS = "http://www.w3.org/2000/svg";

const PATHS = {
  branch: "M6 3v12|M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M18 9a9 9 0 0 1-9 9",
  chevronDown: "m6 9 6 6 6-6",
  chevronRight: "m9 18 6-6-6-6",
  chevronLeft: "m15 18-6-6 6-6",
  arrowDown: "M12 5v14|m19 12-7 7-7-7",
  arrowUp: "m5 12 7-7 7 7|M12 19V5",
  cloudUp: "M12 13v8|m8 17 4-4 4 4|M20 16.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3",
  sync: "M21 12a9 9 0 0 0-15-6.7L3 8|M3 3v5h5|M3 12a9 9 0 0 0 15 6.7l3-2.7|M16 16h5v5",
  check: "M20 6 9 17l-5-5",
  plus: "M5 12h14|M12 5v14",
  minus: "M5 12h14",
  undo: "M9 14 4 9l5-5|M4 9h10.5a5.5 5.5 0 1 1 0 11H11",
  more: "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z|M19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z|M5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z|M14 2v6h6",
  openFile: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z|M14 2v6h6|M9 15h6|M12 12v6",
  folder: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z|m21 21-4.3-4.3",
  x: "M18 6 6 18|m6 6 12 12",
  pr: "M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M13 6h3a2 2 0 0 1 2 2v7|M6 9v12",
  prDraft: "M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M18 11v.01|M18 6v.01|M6 9v12",
  prClosed: "M6 9v12|M18 15V9|m21 3-6 6|m15 3 6 6|M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  merge: "M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M6 21V9a9 9 0 0 0 9 9",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8|M3 3v5h5|M12 7v5l4 2",
  play: "M6 3l14 9-14 9z",
  circle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  dot: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  xCircle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z|m15 9-6 6|m9 9 6 6",
  checkCircle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z|m9 12 2 2 4-4",
  loader: "M21 12a9 9 0 1 1-6.2-8.6",
  warning: "m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3z|M12 9v4|M12 17h.01",
  external: "M15 3h6v6|M10 14 21 3|M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5",
  list: "M8 6h13|M8 12h13|M8 18h13|M3 6h.01|M3 12h.01|M3 18h.01",
  tree: "M21 12h-8|M21 6H8|M21 18h-8|M3 6v4a2 2 0 0 0 2 2h3|M3 10v6a2 2 0 0 0 2 2h3",
  split: "M12 3v18|M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
  wrap: "M3 6h18|M3 12h15a3 3 0 1 1 0 6h-4|m16 16-2 2 2 2|M3 18h7",
  collapse: "m7 20 5-5 5 5|m7 4 5 5 5-5",
  expand: "m7 15 5 5 5-5|m7 9 5-5 5 5",
  refresh: "M21 12a9 9 0 1 1-2.6-6.4L21 8|M21 3v5h-5",
  worktree: "M2 6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v3|M2 10h20v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z|M12 14v4|M10 16h4",
  copy: "M8 8h12v12H8z|M4 16V4h12",
  trash: "M3 6h18|M8 6V4h8v2|M19 6l-1 14H6L5 6|M10 11v6|M14 11v6",
  stash: "M21 8v13H3V8|M1 3h22v5H1z|M10 12h4",
  comment: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
};

export function icon(name, size = 14, className = "") {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  if (className) svg.setAttribute("class", className);
  for (const d of (PATHS[name] ?? "").split("|")) {
    if (!d) continue;
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}
