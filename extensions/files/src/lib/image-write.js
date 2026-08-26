import { strip_slash } from "@/lib/files";

// `muxy.files.write` is UTF-8 only, so binary output goes out as base64 chunks
// that a single shell command reassembles. The command string is constant on
// purpose: Muxy remembers exec consent per exact shell string, so the user is
// asked once and never again.
const TMP_DIR = ".muxy-photo-tmp";
const CHUNK_SIZE = 1_500_000;

const DECODE_COMMAND = [
  "set -e",
  'd=".muxy-photo-tmp"',
  `trap 'rm -rf "$d"' EXIT`,
  't=$(sed -n 1p "$d/dest")',
  'n=$(sed -n 2p "$d/dest")',
  'i=0',
  ': > "$d/all"',
  'while [ "$i" -lt "$n" ]; do',
  '  cat "$d/$(printf \'part-%04d\' "$i")" >> "$d/all"',
  '  i=$((i + 1))',
  "done",
  'base64 -d < "$d/all" > "$t" 2>/dev/null || base64 -D < "$d/all" > "$t"',
].join("\n");

export function base64_of(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export async function blob_to_base64(blob) {
  return base64_of(new Uint8Array(await blob.arrayBuffer()));
}

function part_name(index) {
  return `${TMP_DIR}/part-${String(index).padStart(4, "0")}`;
}

/** Write raw bytes (as base64) to a workspace-relative path. */
export async function write_binary_file(rel, base64) {
  const target = strip_slash(rel);
  if (!target) throw new Error("No destination path");

  const parts = [];
  for (let offset = 0; offset < base64.length; offset += CHUNK_SIZE) {
    parts.push(base64.slice(offset, offset + CHUNK_SIZE));
  }
  if (parts.length === 0) parts.push("");

  try {
    await muxy.files.mkdir(TMP_DIR);
  } catch {
    // Already there from an interrupted save — the parts below overwrite it.
  }

  await muxy.files.write(`${TMP_DIR}/dest`, `${target}\n${parts.length}\n`);
  for (let index = 0; index < parts.length; index += 1) {
    await muxy.files.write(part_name(index), parts[index]);
  }

  const result = await muxy.exec({ shell: DECODE_COMMAND });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr?.trim() || "Could not write the image");
  }
  return target;
}

export async function path_exists(rel) {
  try {
    await muxy.files.stat(strip_slash(rel));
    return true;
  } catch {
    return false;
  }
}
