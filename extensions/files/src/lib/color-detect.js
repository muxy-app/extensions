import { clamp, to_hex2 } from "@/lib/color-convert";

const COLOR_RE = new RegExp(
  [
    "#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b",
    "rgba?\\(\\s*[^)]*\\)",
    "hsla?\\(\\s*[^)]*\\)",
  ].join("|"),
  "g",
);

let NAMED_RE = null;

export const NAMED_COLORS = {
  black: "#000000", silver: "#c0c0c0", gray: "#808080", grey: "#808080",
  white: "#ffffff", maroon: "#800000", red: "#ff0000", purple: "#800080",
  fuchsia: "#ff00ff", magenta: "#ff00ff", green: "#008000", lime: "#00ff00",
  olive: "#808000", yellow: "#ffff00", navy: "#000080", blue: "#0000ff",
  teal: "#008080", aqua: "#00ffff", cyan: "#00ffff", orange: "#ffa500",
  aliceblue: "#f0f8ff", antiquewhite: "#faebd7", aquamarine: "#7fffd4",
  azure: "#f0ffff", beige: "#f5f5dc", bisque: "#ffe4c4", blanchedalmond: "#ffebcd",
  blueviolet: "#8a2be2", brown: "#a52a2a", burlywood: "#deb887", cadetblue: "#5f9ea0",
  chartreuse: "#7fff00", chocolate: "#d2691e", coral: "#ff7f50",
  cornflowerblue: "#6495ed", cornsilk: "#fff8dc", crimson: "#dc143c",
  darkblue: "#00008b", darkcyan: "#008b8b", darkgoldenrod: "#b8860b",
  darkgray: "#a9a9a9", darkgrey: "#a9a9a9", darkgreen: "#006400",
  darkkhaki: "#bdb76b", darkmagenta: "#8b008b", darkolivegreen: "#556b2f",
  darkorange: "#ff8c00", darkorchid: "#9932cc", darkred: "#8b0000",
  darksalmon: "#e9967a", darkseagreen: "#8fbc8f", darkslateblue: "#483d8b",
  darkslategray: "#2f4f4f", darkslategrey: "#2f4f4f", darkturquoise: "#00ced1",
  darkviolet: "#9400d3", deeppink: "#ff1493", deepskyblue: "#00bfff",
  dimgray: "#696969", dimgrey: "#696969", dodgerblue: "#1e90ff",
  firebrick: "#b22222", floralwhite: "#fffaf0", forestgreen: "#228b22",
  gainsboro: "#dcdcdc", ghostwhite: "#f8f8ff", gold: "#ffd700",
  goldenrod: "#daa520", greenyellow: "#adff2f", honeydew: "#f0fff0",
  hotpink: "#ff69b4", indianred: "#cd5c5c", indigo: "#4b0082", ivory: "#fffff0",
  khaki: "#f0e68c", lavender: "#e6e6fa", lavenderblush: "#fff0f5",
  lawngreen: "#7cfc00", lemonchiffon: "#fffacd", lightblue: "#add8e6",
  lightcoral: "#f08080", lightcyan: "#e0ffff", lightgoldenrodyellow: "#fafad2",
  lightgray: "#d3d3d3", lightgrey: "#d3d3d3", lightgreen: "#90ee90",
  lightpink: "#ffb6c1", lightsalmon: "#ffa07a", lightseagreen: "#20b2aa",
  lightskyblue: "#87cefa", lightslategray: "#778899", lightslategrey: "#778899",
  lightsteelblue: "#b0c4de", lightyellow: "#ffffe0", limegreen: "#32cd32",
  linen: "#faf0e6", mediumaquamarine: "#66cdaa", mediumblue: "#0000cd",
  mediumorchid: "#ba55d3", mediumpurple: "#9370db", mediumseagreen: "#3cb371",
  mediumslateblue: "#7b68ee", mediumspringgreen: "#00fa9a",
  mediumturquoise: "#48d1cc", mediumvioletred: "#c71585", midnightblue: "#191970",
  mintcream: "#f5fffa", mistyrose: "#ffe4e1", moccasin: "#ffe4b5",
  navajowhite: "#ffdead", oldlace: "#fdf5e6", olivedrab: "#6b8e23",
  orangered: "#ff4500", orchid: "#da70d6", palegoldenrod: "#eee8aa",
  palegreen: "#98fb98", paleturquoise: "#afeeee", palevioletred: "#db7093",
  papayawhip: "#ffefd5", peachpuff: "#ffdab9", peru: "#cd853f", pink: "#ffc0cb",
  plum: "#dda0dd", powderblue: "#b0e0e6", rosybrown: "#bc8f8f",
  royalblue: "#4169e1", saddlebrown: "#8b4513", salmon: "#fa8072",
  sandybrown: "#f4a460", seagreen: "#2e8b57", seashell: "#fff5ee",
  sienna: "#a0522d", skyblue: "#87ceeb", slateblue: "#6a5acd",
  slategray: "#708090", slategrey: "#708090", snow: "#fffafa",
  springgreen: "#00ff7f", steelblue: "#4682b4", tan: "#d2b48c",
  thistle: "#d8bfd8", tomato: "#ff6347", turquoise: "#40e0d0", violet: "#ee82ee",
  wheat: "#f5deb3", whitesmoke: "#f5f5f5", yellowgreen: "#9acd32",
  rebeccapurple: "#663399",
};

function named_regex() {
  if (NAMED_RE) return NAMED_RE;
  const names = Object.keys(NAMED_COLORS).sort((a, b) => b.length - a.length);
  NAMED_RE = new RegExp(`\\b(?:${names.join("|")})\\b`, "gi");
  return NAMED_RE;
}

function normalize_hex(text) {
  let hex = text.slice(1);
  if (hex.length === 3 || hex.length === 4) {
    hex = hex.split("").map((c) => c + c).join("");
  }
  if (hex.length !== 6 && hex.length !== 8) return null;
  return `#${hex.toLowerCase()}`;
}

function parse_rgb_channel(token) {
  token = token.trim();
  if (token.endsWith("%")) {
    const pct = parseFloat(token);
    return Number.isNaN(pct) ? null : (pct / 100) * 255;
  }
  const num = parseFloat(token);
  return Number.isNaN(num) ? null : num;
}

function parse_alpha(token) {
  token = token.trim();
  if (token.endsWith("%")) {
    const pct = parseFloat(token);
    return Number.isNaN(pct) ? null : clamp(pct / 100, 0, 1);
  }
  const num = parseFloat(token);
  return Number.isNaN(num) ? null : clamp(num, 0, 1);
}

function split_components(inner) {
  const slash = inner.split("/");
  const main = slash[0].trim();
  const parts = main.includes(",") ? main.split(",") : main.split(/\s+/);
  const components = parts.map((p) => p.trim()).filter(Boolean);
  if (slash.length > 1) components.push(slash[1].trim());
  return components;
}

function normalize_rgb(text) {
  const inner = text.slice(text.indexOf("(") + 1, text.lastIndexOf(")"));
  const parts = split_components(inner);
  if (parts.length < 3) return null;
  const r = parse_rgb_channel(parts[0]);
  const g = parse_rgb_channel(parts[1]);
  const b = parse_rgb_channel(parts[2]);
  if (r === null || g === null || b === null) return null;
  let hex = `#${to_hex2(r)}${to_hex2(g)}${to_hex2(b)}`;
  if (parts.length >= 4) {
    const a = parse_alpha(parts[3]);
    if (a !== null && a < 1) hex += to_hex2(a * 255);
  }
  return hex;
}

function hsl_to_rgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 1);
  l = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function normalize_hsl(text) {
  const inner = text.slice(text.indexOf("(") + 1, text.lastIndexOf(")"));
  const parts = split_components(inner);
  if (parts.length < 3) return null;
  const h = parseFloat(parts[0]);
  const s = parts[1].endsWith("%") ? parseFloat(parts[1]) / 100 : parseFloat(parts[1]);
  const l = parts[2].endsWith("%") ? parseFloat(parts[2]) / 100 : parseFloat(parts[2]);
  if (Number.isNaN(h) || Number.isNaN(s) || Number.isNaN(l)) return null;
  const [r, g, b] = hsl_to_rgb(h, s, l);
  let hex = `#${to_hex2(r)}${to_hex2(g)}${to_hex2(b)}`;
  if (parts.length >= 4) {
    const a = parse_alpha(parts[3]);
    if (a !== null && a < 1) hex += to_hex2(a * 255);
  }
  return hex;
}

export function color_to_hex(text) {
  if (text[0] === "#") return normalize_hex(text);
  const lower = text.toLowerCase();
  if (lower.startsWith("rgb")) return normalize_rgb(text);
  if (lower.startsWith("hsl")) return normalize_hsl(text);
  return NAMED_COLORS[lower] ?? null;
}

export function find_colors_in_line(text) {
  const found = [];
  COLOR_RE.lastIndex = 0;
  let match;
  while ((match = COLOR_RE.exec(text)) !== null) {
    const hex = color_to_hex(match[0]);
    if (hex) found.push({ from: match.index, to: match.index + match[0].length, text: match[0], hex });
  }
  const re = named_regex();
  re.lastIndex = 0;
  while ((match = re.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (found.some((c) => start < c.to && end > c.from)) continue;
    const hex = NAMED_COLORS[match[0].toLowerCase()];
    if (hex) found.push({ from: start, to: end, text: match[0], hex });
  }
  found.sort((a, b) => a.from - b.from);
  return found;
}
