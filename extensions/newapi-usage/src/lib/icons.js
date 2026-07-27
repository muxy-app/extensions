import { cls } from "@/lib/dom";

const SVG_NS = "http://www.w3.org/2000/svg";

const ICONS = {
	sparkles: [
		"M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z",
		"M20 3v4",
		"M22 5h-4",
		"M4 17v2",
		"M5 18H3",
	],
	refresh: ["M21 12a9 9 0 1 1-2.64-6.36", "M21 3v6h-6"],
};

export function icon(name, size = 14, className = "", strokeWidth = 2) {
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

	for (const pathData of ICONS[name] || []) {
		const path = document.createElementNS(SVG_NS, "path");
		path.setAttribute("d", pathData);
		svg.appendChild(path);
	}

	return svg;
}
