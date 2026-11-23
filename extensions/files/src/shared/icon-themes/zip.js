// A small, defensive ZIP reader for .vsix packages. It reads the central
// directory (so data descriptors and streamed archives work), supports the two
// methods VSIX writers use (stored and deflate), and refuses archives that try
// to be bigger than a sane icon pack. Inflating uses the platform's
// DecompressionStream, which WebKit and Node both provide.

const EOCD_SIG = 0x06054b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

export const ZIP_LIMITS = {
  maxEntries: 50_000,
  maxEntryBytes: 16 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
};

export class ZipError extends Error {}

function find_eocd(view) {
  // The comment after the end record is at most 65,535 bytes.
  const min = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let i = view.byteLength - 22; i >= min; i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  return -1;
}

function decode_name(bytes, utf8) {
  if (utf8) return new TextDecoder("utf-8").decode(bytes);
  // Without the UTF-8 flag names are CP437; ASCII covers real-world VSIX files,
  // and anything else falls back to a lossy UTF-8 decode.
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/** Normalizes an archive path: forward slashes, no `.`/empty segments, no `..` escape. */
export function normalize_zip_path(path) {
  const out = [];
  for (const part of String(path).replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join("/");
}

async function inflate_raw(bytes) {
  if (typeof DecompressionStream !== "function") throw new ZipError("This app can’t decompress archives (no DecompressionStream).");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export class ZipArchive {
  /** @param {ArrayBuffer|Uint8Array} data */
  constructor(data) {
    this.bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.entries = new Map();
    this.lower = new Map();
    this.parse();
  }

  parse() {
    const { view } = this;
    if (view.byteLength < 22) throw new ZipError("The file is too small to be a .vsix (ZIP) archive.");
    if (view.getUint32(0, true) !== LOCAL_SIG && view.getUint32(0, true) !== EOCD_SIG) {
      throw new ZipError("The file isn’t a .vsix (ZIP) archive.");
    }
    const eocd = find_eocd(view);
    if (eocd < 0) throw new ZipError("The archive is damaged: its end record is missing.");
    let count = view.getUint16(eocd + 10, true);
    let cdSize = view.getUint32(eocd + 12, true);
    let cdOffset = view.getUint32(eocd + 16, true);

    if (count === 0xffff || cdOffset === 0xffffffff) {
      const loc = eocd - 20;
      if (loc >= 0 && view.getUint32(loc, true) === ZIP64_LOCATOR_SIG) {
        const z64 = Number(view.getBigUint64(loc + 8, true));
        if (z64 + 56 <= view.byteLength && view.getUint32(z64, true) === ZIP64_EOCD_SIG) {
          count = Number(view.getBigUint64(z64 + 32, true));
          cdSize = Number(view.getBigUint64(z64 + 40, true));
          cdOffset = Number(view.getBigUint64(z64 + 48, true));
        }
      }
    }
    if (count > ZIP_LIMITS.maxEntries) throw new ZipError(`The archive has too many files (${count}).`);
    if (cdOffset + cdSize > view.byteLength) throw new ZipError("The archive is damaged: its file list is cut off.");

    let total = 0;
    let p = cdOffset;
    for (let i = 0; i < count; i += 1) {
      if (p + 46 > view.byteLength || view.getUint32(p, true) !== CENTRAL_SIG) {
        throw new ZipError("The archive is damaged: a file entry is unreadable.");
      }
      const flags = view.getUint16(p + 8, true);
      const method = view.getUint16(p + 10, true);
      let compressed = view.getUint32(p + 20, true);
      let size = view.getUint32(p + 24, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      let offset = view.getUint32(p + 42, true);
      const rawName = decode_name(this.bytes.subarray(p + 46, p + 46 + nameLen), (flags & 0x800) !== 0);

      // ZIP64 extra field carries the real sizes when the 32-bit ones overflow.
      let e = p + 46 + nameLen;
      const extraEnd = e + extraLen;
      while (e + 4 <= extraEnd) {
        const id = view.getUint16(e, true);
        const len = view.getUint16(e + 2, true);
        if (id === 0x0001) {
          let q = e + 4;
          if (size === 0xffffffff) (size = Number(view.getBigUint64(q, true))), (q += 8);
          if (compressed === 0xffffffff) (compressed = Number(view.getBigUint64(q, true))), (q += 8);
          if (offset === 0xffffffff) offset = Number(view.getBigUint64(q, true));
        }
        e += 4 + len;
      }
      p = extraEnd + commentLen;

      const name = normalize_zip_path(rawName);
      if (!name || rawName.endsWith("/")) continue;
      total += size;
      if (total > ZIP_LIMITS.maxTotalBytes) throw new ZipError("The archive expands to more data than an icon pack should.");
      const entry = { name, method, compressed, size, offset, encrypted: (flags & 1) !== 0 };
      this.entries.set(name, entry);
      if (!this.lower.has(name.toLowerCase())) this.lower.set(name.toLowerCase(), name);
    }
  }

  /** The stored name for `path`, matching case-insensitively as a fallback. */
  resolve(path) {
    const name = normalize_zip_path(path);
    if (name === null) return null;
    if (this.entries.has(name)) return name;
    return this.lower.get(name.toLowerCase()) ?? null;
  }

  has(path) {
    return this.resolve(path) !== null;
  }

  sizeOf(path) {
    const name = this.resolve(path);
    return name ? this.entries.get(name).size : -1;
  }

  async bytesOf(path) {
    const name = this.resolve(path);
    if (!name) throw new ZipError(`Missing file in archive: ${path}`);
    const entry = this.entries.get(name);
    if (entry.encrypted) throw new ZipError(`Encrypted file in archive: ${name}`);
    if (entry.size > ZIP_LIMITS.maxEntryBytes) throw new ZipError(`File too large in archive: ${name}`);
    const { view } = this;
    const local = entry.offset;
    if (local + 30 > view.byteLength || view.getUint32(local, true) !== LOCAL_SIG) {
      throw new ZipError(`The archive is damaged near ${name}.`);
    }
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const end = start + entry.compressed;
    if (end > view.byteLength) throw new ZipError(`The archive is cut off inside ${name}.`);
    const raw = this.bytes.subarray(start, end);
    let out;
    if (entry.method === 0) out = raw;
    else if (entry.method === 8) out = await inflate_raw(raw);
    else throw new ZipError(`Unsupported compression (method ${entry.method}) for ${name}.`);
    if (out.byteLength !== entry.size) throw new ZipError(`The archive is damaged: ${name} has the wrong size.`);
    return out;
  }

  async textOf(path) {
    return new TextDecoder("utf-8").decode(await this.bytesOf(path));
  }
}
