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
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  branch: '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  merge: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
  commit: '<circle cx="12" cy="12" r="3"/><line x1="3" x2="9" y1="12" y2="12"/><line x1="15" x2="21" y1="12" y2="12"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  hammer: '<path d="m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9"/><path d="m18 15 4-4"/><path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756l-2.524-.317a1 1 0 0 0-1.054.845L9 5l1 1H6.5L5 6.5V9l1 1-1.088 1.088a1 1 0 0 0-.141.354l-.317 2.524a6 6 0 0 0-1.756 4.202L2.5 20.5l4 1 1-4"/>',
  cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
  server: '<rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  bug: '<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  key: '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="M21 2l-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  keyboard: '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  pen: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  ship: '<path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76"/><path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/><path d="M12 10v4"/><path d="M12 2v3"/>',
  tube: '<path d="M14.5 2v17.5c0 1.4-1.1 2.5-2.5 2.5c-1.4 0-2.5-1.1-2.5-2.5V2"/><path d="M8.5 2h7"/><path d="M14.5 16h-5"/>',
  boxes: '<path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l7 4a2 2 0 0 0 2.06 0l7-4A2 2 0 0 0 22 17.87v-3.24a2 2 0 0 0-.97-1.71l-7-4a2 2 0 0 0-2.06 0l-7 4Z"/><path d="m7 16.5-4.74-2.85"/><path d="m7 7.5 8.75-5.12"/><path d="M7 7.5v9"/><path d="M22 7.5l-8.75 5.12"/>',
};

export const PRESET_ICONS = Object.keys(GLYPHS);

const ICON_CACHE_KEY = 'muxy-launcher:icon-cache';
const MAX_CACHE_ENTRIES = 50;
const MAX_ICON_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_ICON_STORAGE_CHARS = 120 * 1024;
const ICON_RASTER_SIZES = [96, 64, 48, 32];

function isEmoji(value) {
  return value && !GLYPHS[value] && [...value].length <= 2;
}

export function isImageSrc(value) {
  const v = String(value || '');
  return /^(data:|https?:\/\/|\.{0,2}\/)/i.test(v) || /\.(svg|png|jpe?g|gif|webp)$/i.test(v);
}

export function isHttpImageSrc(value) {
  return /^https?:\/\//i.test(String(value || ''));
}

function glyphSVG(name, size) {
  const glyph = GLYPHS[name] || GLYPHS.terminal;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${glyph}</svg>`;
}

export function iconHTML(value, size = 14) {
  const name = value || 'terminal';
  if (isImageSrc(name)) {
    const src = cachedIconSrc(name) || name;
    const fallback = glyphSVG('terminal', size).replace(/"/g, '&quot;');
    return `<img class="icon-img" src="${escapeHTML(src)}" width="${size}" height="${size}" alt="" ` +
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

export async function cacheIconSrc(url) {
  if (!isHttpImageSrc(url)) return null;
  const response = await fetch(url, { cache: 'reload' });
  if (!response.ok) throw new Error(`Could not fetch icon (${response.status}).`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_ICON_RESPONSE_BYTES) throw new Error('The icon URL points to an image that is too large.');
  const blob = await response.blob();
  if (blob.size > MAX_ICON_RESPONSE_BYTES) throw new Error('The icon URL points to an image that is too large.');
  if (!isSupportedImageBlob(blob, url)) throw new Error('Use an SVG, PNG, JPG, GIF, or WebP image URL.');
  const src = isSvgBlob(blob, url)
    ? await svgBlobSrc(blob)
    : await rasterBlobSrc(blob);
  saveCachedIconSrc(url, src);
  return src;
}

export function cachedIconSrc(url) {
  if (!isHttpImageSrc(url)) return null;
  return readIconCache()[url]?.src || null;
}

function isSupportedImageBlob(blob, url) {
  return isSvgBlob(blob, url) || /^image\/(png|jpe?g|gif|webp)$/i.test(blob.type || '');
}

function isSvgBlob(blob, url) {
  if (blob.type) return /^image\/svg\+xml$/i.test(blob.type);
  return /\.svg(?:[?#].*)?$/i.test(url);
}

async function svgBlobSrc(blob) {
  const source = (await blob.text()).trim();
  if (!/<svg[\s>]/i.test(source)) throw new Error('The icon URL did not return a valid SVG.');
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
  if (src.length > MAX_ICON_STORAGE_CHARS) throw new Error('The SVG icon is too large to cache.');
  return src;
}

async function rasterBlobSrc(blob) {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await loadImage(objectUrl);
    for (const size of ICON_RASTER_SIZES) {
      const scale = Math.min(1, size / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
      const width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
      const height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not process that icon.');
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      const src = canvasIconSrc(canvas);
      if (src.length <= MAX_ICON_STORAGE_CHARS) return src;
    }
    throw new Error('The icon is too large to cache.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function canvasIconSrc(canvas) {
  const webp = canvas.toDataURL('image/webp', 0.9);
  if (webp.startsWith('data:image/webp')) return webp;
  return canvas.toDataURL('image/png');
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that icon image.'));
    img.src = src;
  });
}

let iconCacheMemo = null;

window.addEventListener('storage', (event) => {
  if (event.key === ICON_CACHE_KEY || event.key === null) iconCacheMemo = null;
});

function readIconCache() {
  if (iconCacheMemo) return iconCacheMemo;
  try {
    const parsed = JSON.parse(localStorage.getItem(ICON_CACHE_KEY) || '{}');
    iconCacheMemo = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    iconCacheMemo = {};
  }
  return iconCacheMemo;
}

function saveCachedIconSrc(url, src) {
  const cache = { ...readIconCache(), [url]: { src, cachedAt: Date.now() } };
  const entries = Object.entries(cache)
    .sort((a, b) => Number(b[1]?.cachedAt || 0) - Number(a[1]?.cachedAt || 0))
    .slice(0, MAX_CACHE_ENTRIES);
  iconCacheMemo = Object.fromEntries(entries);
  localStorage.setItem(ICON_CACHE_KEY, JSON.stringify(iconCacheMemo));
}
