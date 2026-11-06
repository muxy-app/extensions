import { icon } from "@muxy/ui";

// Lucide path data (https://lucide.dev, ISC license), rendered through @muxy/ui's
// `icon()` so every glyph follows the native 1.5px / round-cap stroke contract.
const PATHS = {
  braces: [
    "M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1",
    "M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1",
  ],
  search: ["M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0z", "m21 21-4.3-4.3"],
  plus: ["M5 12h14", "M12 5v14"],
  play: ["M6 3l14 9-14 9V3z"],
  insert: ["M20 4v7a4 4 0 0 1-4 4H4", "m9 10-5 5 5 5"],
  tab: ["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "m7 11 2-2-2-2", "M11 13h4"],
  terminal: ["m4 17 6-6-6-6", "M12 19h8"],
  folder: [
    "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z",
  ],
  importExport: ["m21 16-4 4-4-4", "M17 20V4", "m3 8 4-4 4 4", "M7 4v16"],
  chevronDown: ["m6 9 6 6 6-6"],
  chevronLeft: ["m15 18-6-6 6-6"],
  chevronUp: ["m18 15-6-6-6 6"],
  pencil: [
    "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
    "m15 5 4 4",
  ],
  copy: [
    "M9 9h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2z",
    "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
  ],
  clipboard: [
    "M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z",
    "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2",
  ],
  trash: [
    "M3 6h18",
    "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
    "M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6",
    "M10 11v6",
    "M14 11v6",
  ],
  lock: ["M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z", "M7 11V7a5 5 0 0 1 10 0v4"],
};

/** Inline SVG markup for an icon, for use inside HTML templates. */
export function svg(name, size = 14) {
  const paths = PATHS[name];
  if (!paths) throw new Error(`unknown icon '${name}'`);
  return icon(paths, { size }).outerHTML;
}
