import { icon_svg } from "@/shared/dom";

// Topbar glyphs, drawn after the SF Symbols Muxy's own toolbars use
// (square.and.arrow.down, folder, arrow.up.right.square, gearshape,
// list.bullet) and sized to match them: Muxy renders those at a 14 pt point
// size and semibold weight, which comes out ~17 px across with a ~1.6 px line.
const SIZE = 17;
const STROKE = 2.3;

const glyph = (paths) => () => icon_svg(paths, SIZE, STROKE);

export const SaveIcon = glyph([
  { d: "M8 8.5H6.5a2.5 2.5 0 0 0-2.5 2.5v7.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V11a2.5 2.5 0 0 0-2.5-2.5H16" },
  { d: "M12 2.5v12" },
  { d: "M8.25 11 12 14.75 15.75 11" },
]);

export const RevealIcon = glyph([
  { d: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" },
  { d: "M2 9.5h20" },
]);

export const OpenIcon = glyph([
  { kind: "rect", x: "3.5", y: "3.5", width: "17", height: "17", rx: "3.5" },
  { d: "M9.5 8.5h6v6" },
  { d: "M15.5 8.5l-7 7" },
]);

export const TocIcon = glyph([
  { d: "M8.5 6h13M8.5 12h13M8.5 18h13" },
  { kind: "circle", cx: "3.5", cy: "6", r: "1.5", fill: "currentColor", stroke: "none" },
  { kind: "circle", cx: "3.5", cy: "12", r: "1.5", fill: "currentColor", stroke: "none" },
  { kind: "circle", cx: "3.5", cy: "18", r: "1.5", fill: "currentColor", stroke: "none" },
]);

export const SettingsIcon = glyph([
  {
    d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
  },
  { kind: "circle", cx: "12", cy: "12", r: "3" },
]);
