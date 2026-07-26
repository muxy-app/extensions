import { strip_slash } from "@/lib/files";
import { worktree_root } from "@/lib/worktree-root";

export async function read_binary_base64(filePath, kind = "file") {
  const rel = strip_slash(filePath);
  if (!rel) throw new Error("No file path");
  const cwd = await worktree_root();
  const res = await muxy.exec(["base64", "-i", rel], { cwd });
  if (res.exitCode !== 0) {
    throw new Error(res.stderr?.trim() || `Could not read ${kind}`);
  }
  const base64 = res.stdout.replace(/\s+/g, "");
  if (!base64) throw new Error(`${kind[0].toUpperCase()}${kind.slice(1)} is empty`);
  return base64;
}

export async function read_binary_bytes(filePath, kind = "file") {
  const base64 = await read_binary_base64(filePath, kind);
  const decoded = atob(base64);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}
