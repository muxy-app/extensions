const GLYPHS = {
  terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  sparkles: '<path d="M12 3v4"/><path d="M12 17v4"/><path d="M3 12h4"/><path d="M17 12h4"/><path d="m6 6 2 2"/><path d="m16 16 2 2"/><path d="m18 6-2 2"/><path d="m8 16-2 2"/>',
  code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  rocket: '<path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2 0-2.8a2 2 0 0 0-3 0z"/><path d="m12 15-3-3a22 22 0 0 1 8-10 22 22 0 0 1 2 10 22 22 0 0 1-7 3z"/><path d="M9 12H4s.5-3 2-4 5-2 5-2"/><path d="M12 15v5s3-.5 4-2 2-5 2-5"/>',
  robot: '<rect width="16" height="12" x="4" y="8" rx="2"/><path d="M12 8V4"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/><path d="M2 14h2"/><path d="M20 14h2"/>',
  brain: '<path d="M12 5a3 3 0 1 0-5.9.7A3 3 0 0 0 4 9a3 3 0 0 0 2 2.8V13a3 3 0 0 0 3 3h.5"/><path d="M12 5a3 3 0 1 1 5.9.7A3 3 0 0 1 20 9a3 3 0 0 1-2 2.8V13a3 3 0 0 1-3 3h-.5"/><path d="M12 5v14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.92.78 2 2 0 1 1-4 0 1.65 1.65 0 0 0-2.92-.78l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a2 2 0 1 1 0-4 1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 2.92-.78 2 2 0 1 1 4 0 1.65 1.65 0 0 0 2.92.78l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a2 2 0 1 1 0 4z"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  star: '<polygon points="12 2 15 9 22 9 16 14 18 21 12 17 6 21 8 14 2 9 9 9"/>',
  package: '<path d="M16.5 9.4 7.5 4.2"/><path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1-1.5-1-3.5 0-5 .5 2 2 3 3.5 4.5C15 10 16 11.5 16 14a4 4 0 0 1-8 0c0-.6.1-1.2.3-1.7"/>',
};

export const PRESET_ICONS = Object.keys(GLYPHS);

function isEmoji(value) {
  return value && !GLYPHS[value] && [...value].length <= 2;
}

export function isImageSrc(value) {
  const v = String(value || '');
  return /^(data:|https?:\/\/|\.{0,2}\/)/i.test(v) || /\.(svg|png|jpe?g|gif|webp)$/i.test(v);
}

function glyphSVG(name, size) {
  const glyph = GLYPHS[name] || GLYPHS.terminal;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${glyph}</svg>`;
}

export function iconHTML(value, size = 14) {
  const name = value || 'terminal';
  if (isImageSrc(name)) {
    const fallback = glyphSVG('terminal', size).replace(/"/g, '&quot;');
    return `<img class="icon-img" src="${escapeHTML(name)}" width="${size}" height="${size}" alt="" ` +
      `onerror="this.outerHTML='${fallback.replace(/'/g, "\\'")}'" />`;
  }
  if (isEmoji(name)) {
    return `<span class="emoji" style="font-size:${size}px;line-height:1">${escapeHTML(name)}</span>`;
  }
  return glyphSVG(name, size);
}

export function iconElement(value, size = 14) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = iconHTML(value, size);
  return span;
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
