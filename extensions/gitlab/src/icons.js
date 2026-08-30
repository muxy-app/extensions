// Inline SVG glyphs. 1.5px strokes, round caps/joins, sized to the Muxy scale.

const s = (body, size = 13) =>
  `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICON_ISSUE_OPEN = s(`<circle cx="8" cy="8" r="6.25"/><path d="M8 5v3.5"/><circle cx="8" cy="11" r="0.4" fill="currentColor"/>`, 14);
export const ICON_ISSUE_CLOSED = s(`<circle cx="8" cy="8" r="6.25"/><path d="M5.5 8l1.75 1.75L11 6"/>`, 14);
export const ICON_MR = s(`<circle cx="4" cy="4" r="1.5"/><circle cx="4" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><path d="M4 5.5v5M12 10.5V8a3 3 0 0 0-3-3H6.5M8.5 3.5L6 5l2.5 1.5"/>`, 14);

export const ICON_STATE = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>`;
export const ICON_EMPTY = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 12h6"/></svg>`;

export const ICON_SEARCH = s(`<circle cx="7" cy="7" r="4.5"/><path d="M13 13l-2.6-2.6"/>`, 14);
export const ICON_REFRESH = s(`<path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5V5H11"/>`, 14);
export const ICON_BACK = s(`<path d="M10 3.5L5.5 8l4.5 4.5"/>`);
export const ICON_OPEN_EXT = s(`<path d="M9 3h4v4M13 3L7 9M11 9v3.5A1.5 1.5 0 0 1 9.5 14h-6A1.5 1.5 0 0 1 2 12.5v-6A1.5 1.5 0 0 1 3.5 5H7"/>`);

export const ICON_BRANCH = s(`<circle cx="4" cy="4" r="1.5"/><circle cx="4" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><path d="M4 5.5v5M12 10.5V8a3 3 0 0 0-3-3H6.5"/>`);
export const ICON_FILES = s(`<path d="M4 2h5l3 3v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M9 2v3h3"/>`);
export const ICON_TAG = s(`<path d="M8.5 2H3.5a1 1 0 0 0-1 1v5a1 1 0 0 0 .29.71l6 6a1 1 0 0 0 1.42 0l5-5a1 1 0 0 0 0-1.42l-6-6A1 1 0 0 0 8.5 2z"/><circle cx="5.5" cy="5.5" r="1"/>`);
export const ICON_PERSON = s(`<circle cx="8" cy="5.5" r="2.5"/><path d="M3 14c0-2.76 2.24-4.5 5-4.5s5 1.74 5 4.5"/>`);
export const ICON_MILESTONE = s(`<path d="M4 14V2M4 3h6.5L9 5.5 10.5 8H4"/>`);
export const ICON_COMMENT = s(`<path d="M2 3.5h12v8H6.5L3 14.5v-3H2z"/>`);
export const ICON_EDIT = s(`<path d="M11 2l3 3-8 8-3.5.5.5-3.5z"/>`);
export const ICON_EYE = s(`<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.75"/>`);
export const ICON_DOWNLOAD = s(`<path d="M8 2v8m0 0l-3-3m3 3l3-3M3 13.5h10"/>`);
export const ICON_PIPELINE = s(`<circle cx="8" cy="8" r="6.25"/><path d="M8 4.5V8l2.5 1.5"/>`);
export const ICON_APPROVE = s(`<path d="M2.5 8.5L6 12l7.5-8"/>`);
export const ICON_CLOCK = s(`<circle cx="8" cy="8" r="6.25"/><path d="M8 4.5V8l2.5 1.5"/>`);
export const ICON_WEIGHT = s(`<path d="M3 5h10l-1.5 8h-7z"/><path d="M6 5V3.5h4V5"/>`);
