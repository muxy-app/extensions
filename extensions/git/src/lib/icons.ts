import { cls } from "@/lib/dom";

const ICONS = {
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
  branch: '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  pr: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" x2="6" y1="9" y2="21"/>',
  prClosed: '<path d="M6 9v12"/><path d="M18 15V9"/><path d="m21 3-6 6"/><path d="m15 3 6 6"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/><path d="M12 7v5l3 2"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 1 1 0 11H11"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  arrowDown: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  arrowUp: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  loader: '<path d="M12 2v4"/><path d="m16.2 7.8 2.9-2.9"/><path d="M18 12h4"/><path d="m16.2 16.2 2.9 2.9"/><path d="M12 18v4"/><path d="m4.9 19.1 2.9-2.9"/><path d="M2 12h4"/><path d="m4.9 4.9 2.9 2.9"/>',
  xCircle: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
  merge: '<path d="M18 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M6 6a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M6 3v5a6 6 0 0 0 6 6h3"/>',
  circleDashed: '<path d="M10.1 2.2a10 10 0 0 1 3.8 0"/><path d="M17.6 4.2a10 10 0 0 1 2.2 3.2"/><path d="M21.8 10.1a10 10 0 0 1 0 3.8"/><path d="M19.8 17.6a10 10 0 0 1-3.2 2.2"/><path d="M13.9 21.8a10 10 0 0 1-3.8 0"/><path d="M6.4 19.8a10 10 0 0 1-2.2-3.2"/><path d="M2.2 13.9a10 10 0 0 1 0-3.8"/><path d="M4.2 6.4a10 10 0 0 1 3.2-2.2"/>',
  fileDiff: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="M9 15h6"/>',
  folderGit: '<path d="M2 6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v3"/><path d="M2 10h20v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z"/><circle cx="12" cy="15" r="1"/><circle cx="17" cy="18" r="1"/><path d="M13 15h2a2 2 0 0 1 2 2v1"/>',
  branchPlus: '<path d="M6 3v12"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/><path d="M18 15v6"/><path d="M15 18h6"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  list: '<path d="M3 5h18"/><path d="M3 12h18"/><path d="M3 19h18"/>',
} as const;

export type IconName = keyof typeof ICONS;

export function icon(
  name: IconName,
  size = 13,
  className = "",
  strokeWidth = 2,
): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", String(strokeWidth));
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.className.baseVal = cls("shrink-0", className);
  svg.innerHTML = ICONS[name];
  return svg;
}
