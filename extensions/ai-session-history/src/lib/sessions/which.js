import { PROVIDERS } from "@/lib/sessions/providers";

/**
 * Detect which AI CLIs are on PATH.
 * One bash -lc probes all candidate binaries (single argvPrefix for consent).
 * @returns {Promise<Array<{id:string,displayName:string,binary:string,path?:string}>>}
 */
export async function detectInstalled() {
  // Build a single script: for each name, print "name\\0path" when found.
  // Names are fixed provider registry strings (no user input).
  const allNames = [];
  for (const p of PROVIDERS) {
    for (const name of p.binaries) {
      if (!allNames.includes(name)) allNames.push(name);
    }
  }
  // Safe: binaries are static identifiers [A-Za-z0-9_-]
  const list = allNames.map((n) => `'${n}'`).join(" ");
  const script = `
for c in ${list}; do
  p=$(command -v "$c" 2>/dev/null) || continue
  printf '%s=%s\\n' "$c" "$p"
done
`.trim();

  /** @type {Map<string, string>} */
  const found = new Map();
  try {
    const result = await muxy.exec(["bash", "-lc", script], { timeoutMs: 8000 });
    const stdout = String(result.stdout ?? "");
    for (const line of stdout.split("\n")) {
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const name = line.slice(0, eq).trim();
      const path = line.slice(eq + 1).trim();
      if (name && path) found.set(name, path);
    }
  } catch {
    // Fall through — no CLIs detected
  }

  const installed = [];
  for (const provider of PROVIDERS) {
    let path = null;
    for (const name of provider.binaries) {
      if (found.has(name)) {
        path = found.get(name);
        break;
      }
    }
    if (path) {
      installed.push({
        id: provider.id,
        displayName: provider.displayName,
        binary: provider.binary,
        path,
      });
    }
  }
  return installed;
}
