import { strip_slash } from "@/shared/paths";

/** The file as committed at HEAD, or null when it isn't tracked (or no repo). */
export async function head_baseline(filePath) {
  const rel = strip_slash(filePath);
  if (!rel) return null;
  try {
    // `exec` runs in the project folder; `./` keeps the path relative to it
    // even when the project is a subfolder of the repository.
    const res = await muxy.exec(["git", "show", `HEAD:./${rel}`]);
    return res.exitCode === 0 ? res.stdout : null;
  } catch {
    return null;
  }
}
