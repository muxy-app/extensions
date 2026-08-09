import { cls } from "@/lib/dom";

// SVG namespace URI — required by the DOM spec, not a configurable URL.
const SVG_NS = "http://www.w3.org/2000/svg";

const ICONS = {
	sparkles:
		'<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
	refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
	"list-checks":
		'<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
	plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
	check: '<path d="M20 6 9 17l-5-5"/>',
	x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
	"trash-2":
		'<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
	"grip-vertical":
		'<line x1="9" x2="9" y1="5" y2="19"/><line x1="15" x2="15" y1="5" y2="19"/>',
};

// Parse trusted icon markup into real SVG nodes (no innerHTML on the live tree).
function parseIconMarkup(inner) {
	const doc = new DOMParser().parseFromString(
		`<svg xmlns="${SVG_NS}">${inner}</svg>`,
		"image/svg+xml",
	);
	return [...doc.documentElement.childNodes];
}

export function icon(name, size = 14, className = "", strokeWidth = 2) {
	const paths = ICONS[name];
	if (!paths) throw new Error(`Unknown icon: ${name}`);
	const svg = document.createElementNS(SVG_NS, "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("width", String(size));
	svg.setAttribute("height", String(size));
	svg.setAttribute("fill", "none");
	svg.setAttribute("stroke", "currentColor");
	svg.setAttribute("stroke-width", String(strokeWidth));
	svg.setAttribute("stroke-linecap", "round");
	svg.setAttribute("stroke-linejoin", "round");
	svg.setAttribute("aria-hidden", "true");
	svg.setAttribute("class", cls("shrink-0", className));
	svg.append(...parseIconMarkup(paths));
	return svg;
}
