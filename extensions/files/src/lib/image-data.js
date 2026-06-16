import { strip_slash } from "@/lib/files";
import { image_mime } from "@/lib/languages";
import { worktree_root } from "@/lib/worktree-root";

// `muxy.files.read` only returns UTF-8 text, so image bytes are pulled in by
// shelling out to `base64` (always present on macOS) from the worktree root.
// The relative path keeps reads scoped to the same root the file tree uses.
export async function read_image_data_url(filePath) {
  const rel = strip_slash(filePath);
  if (!rel) throw new Error("No file path");
  const cwd = await worktree_root();
  const res = await muxy.exec(["base64", "-i", rel], { cwd });
  if (res.exitCode !== 0) {
    throw new Error(res.stderr?.trim() || "Could not read image");
  }
  const base64 = res.stdout.replace(/\s+/g, "");
  if (!base64) throw new Error("Image is empty");
  return `data:${image_mime(filePath)};base64,${base64}`;
}
