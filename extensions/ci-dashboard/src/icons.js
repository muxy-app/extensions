// Inline SVG glyphs. 1.5px strokes, round caps/joins, sized to the Muxy scale.

const s = (body, size = 13) =>
  `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICON_SUCCESS = s(`<circle cx="8" cy="8" r="6.25"/><path d="M5.4 8.1l1.8 1.8L10.8 6"/>`, 14);
export const ICON_FAILED = s(`<circle cx="8" cy="8" r="6.25"/><path d="M6 6l4 4M10 6l-4 4"/>`, 14);
export const ICON_RUNNING = s(`<circle cx="8" cy="8" r="6.25"/><path d="M8 4.4V8l2.4 1.5"/>`, 14);
export const ICON_QUEUED = s(`<circle cx="8" cy="8" r="6.25" stroke-dasharray="2.2 2.2"/>`, 14);
export const ICON_CANCELED = s(`<circle cx="8" cy="8" r="6.25"/><path d="M3.9 12.1l8.2-8.2"/>`, 14);
export const ICON_SKIPPED = s(`<circle cx="8" cy="8" r="6.25"/><path d="M5.5 8h5"/>`, 14);
export const ICON_MANUAL = s(`<circle cx="8" cy="8" r="6.25"/><path d="M6.5 5.8v4.4M9.5 5.8v4.4"/>`, 14);
export const ICON_UNKNOWN = s(`<circle cx="8" cy="8" r="6.25"/><path d="M6.4 6.3a1.7 1.7 0 1 1 1.9 2.3v.9"/><circle cx="8.3" cy="11.4" r="0.4" fill="currentColor"/>`, 14);

export const ICON_STATE = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>`;
export const ICON_EMPTY = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 12h6"/></svg>`;
export const ICON_PLUG = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v4"/></svg>`;

export const ICON_BACK = s(`<path d="M10 3.5L5.5 8l4.5 4.5"/>`);
export const ICON_OPEN_EXT = s(`<path d="M9 3h4v4M13 3L7 9M11 9v3.5A1.5 1.5 0 0 1 9.5 14h-6A1.5 1.5 0 0 1 2 12.5v-6A1.5 1.5 0 0 1 3.5 5H7"/>`);
export const ICON_RETRY = s(`<path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5V5H11"/>`);
export const ICON_CANCEL = s(`<circle cx="8" cy="8" r="6.25"/><path d="M3.9 12.1l8.2-8.2"/>`);
export const ICON_BRANCH = s(`<circle cx="4" cy="4" r="1.5"/><circle cx="4" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><path d="M4 5.5v5M12 10.5V8a3 3 0 0 0-3-3H6.5"/>`);
export const ICON_CLOCK = s(`<circle cx="8" cy="8" r="6.25"/><path d="M8 4.5V8l2.5 1.5"/>`);
export const ICON_COMMIT = s(`<circle cx="8" cy="8" r="2.6"/><path d="M2 8h3.4M10.6 8H14"/>`);
export const ICON_LOG = s(`<path d="M3 3h10v10H3z"/><path d="M5.4 6.2h5.2M5.4 8.4h5.2M5.4 10.6h3"/>`);
export const ICON_TARGET = s(`<circle cx="8" cy="8" r="6.25"/><circle cx="8" cy="8" r="2.6"/>`);
export const ICON_TRASH = s(`<path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.6 8.2h4.8L11 4.5"/>`);
export const ICON_PLUS = s(`<path d="M8 3.5v9M3.5 8h9"/>`);
export const ICON_EDIT = s(`<path d="M11 2l3 3-8 8-3.5.5.5-3.5z"/>`);
export const ICON_ROCKET = s(`<path d="M9 2.5c2.6.5 4.5 2.4 4.5 5 0 2-1.4 3.6-2.5 4.5H5C3.9 11.1 2.5 9.5 2.5 7.5c0-2.6 1.9-4.5 4.5-5z"/><circle cx="8" cy="6.5" r="1.3"/>`);

/** Per-status glyph for run and job rows. */
export const STATUS_ICONS = {
  success: ICON_SUCCESS,
  failed: ICON_FAILED,
  running: ICON_RUNNING,
  queued: ICON_QUEUED,
  canceled: ICON_CANCELED,
  skipped: ICON_SKIPPED,
  manual: ICON_MANUAL,
  unknown: ICON_UNKNOWN,
};
