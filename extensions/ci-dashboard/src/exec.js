// The single door to the outside world. Providers shell out through here so
// that "the CLI isn't installed" is one recognizable error everywhere.

const MISSING_RE = /command not found|no such file|executable file not found|not found in \$path/i;

export class CIError extends Error {
  constructor(kind, message, raw = "") {
    super(message);
    this.name = "CIError";
    this.kind = kind; // missing | auth | failed
    this.raw = raw;
  }
}

const AUTH_RE = /401|403|invalid_token|token is expired|not logged in|no token|unauthorized|gh auth login|glab auth login/i;

export function classify(output) {
  const text = String(output || "");
  if (MISSING_RE.test(text)) return "missing";
  if (AUTH_RE.test(text)) return "auth";
  return "failed";
}

/** Raw exec. Resolves with the exit code rather than throwing on failure. */
export async function exec(argv, cwd = "") {
  if (!window.muxy || typeof window.muxy.exec !== "function") {
    throw new CIError("failed", "muxy.exec is unavailable (requires the commands:exec permission).");
  }
  try {
    const res = cwd ? await window.muxy.exec(argv, { cwd }) : await window.muxy.exec(argv);
    return {
      stdout: res?.stdout ?? "",
      stderr: res?.stderr ?? "",
      code: res?.exitCode ?? res?.code ?? 0,
    };
  } catch (e) {
    // A missing binary can arrive as a rejection rather than a non-zero exit.
    const message = e?.message || String(e);
    throw new CIError(classify(message), message, message);
  }
}

/** Exec that throws a classified CIError on a non-zero exit. */
export async function run(argv, cwd = "") {
  const { stdout, stderr, code } = await exec(argv, cwd);
  if (code !== 0) {
    const output = stderr || stdout;
    throw new CIError(classify(output), (output || `${argv[0]} failed`).trim(), output);
  }
  return stdout;
}

/** Exec that parses stdout as JSON. */
export async function runJSON(argv, cwd = "") {
  const stdout = await run(argv, cwd);
  try {
    return JSON.parse(stdout || "null");
  } catch {
    throw new CIError("failed", `Could not parse ${argv[0]} output as JSON.`, stdout);
  }
}

/** True when a binary is on PATH. Cached, since it cannot change mid-session. */
const availability = new Map();
export async function isAvailable(binary) {
  if (availability.has(binary)) return availability.get(binary);
  let ok = false;
  try {
    const { code } = await exec(["which", binary]);
    ok = code === 0;
  } catch {
    ok = false;
  }
  availability.set(binary, ok);
  return ok;
}

export async function openUrl(url) {
  if (!url) return;
  try {
    await exec(["open", url]);
  } catch (e) {
    console.error("[ci-dashboard] failed to open:", e);
  }
}
