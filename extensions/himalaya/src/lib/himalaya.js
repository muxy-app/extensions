// Thin wrapper around the Himalaya CLI (https://github.com/pimalaya/himalaya).
//
// Every call shells out through `muxy.exec` and, wherever possible, asks
// Himalaya for `--json` so the panel works with structured data instead of
// scraping the rendered tables.

const DEFAULT_TIMEOUT = 30000;

// Common places a Himalaya binary lives when it is not already on the exec
// PATH (Muxy's exec environment is not a login shell, so `~/.local/bin` and
// Homebrew paths are often missing).
const FALLBACK_PATHS = [
  "/opt/homebrew/bin/himalaya",
  "/usr/local/bin/himalaya",
  "/usr/bin/himalaya",
  "/run/current-system/sw/bin/himalaya",
];

export class HimalayaError extends Error {
  constructor(message, { stderr = "", stdout = "", exitCode = -1 } = {}) {
    super(message);
    this.name = "HimalayaError";
    this.stderr = stderr;
    this.stdout = stdout;
    this.exitCode = exitCode;
  }
}

// A binary that could not be located at all — the panel shows an install hint.
export class HimalayaMissingError extends HimalayaError {
  constructor(message) {
    super(message);
    this.name = "HimalayaMissingError";
  }
}

let resolvedBinary = null;

async function pathExists(path) {
  try {
    const res = await muxy.exec(["/bin/test", "-x", path], { timeoutMs: 5000 });
    return res.exitCode === 0;
  } catch {
    return false;
  }
}

// Resolve the himalaya executable once: honour the configured override, then
// `which`, then a handful of well-known locations. Cached for the session.
export async function resolveBinary(override) {
  if (override) return override;
  if (resolvedBinary) return resolvedBinary;

  try {
    const res = await muxy.exec(["/usr/bin/which", "himalaya"], { timeoutMs: 5000 });
    if (res.exitCode === 0) {
      const path = res.stdout.trim().split("\n")[0];
      if (path) {
        resolvedBinary = path;
        return path;
      }
    }
  } catch {
    // fall through to the fallback locations
  }

  for (const path of FALLBACK_PATHS) {
    if (await pathExists(path)) {
      resolvedBinary = path;
      return path;
    }
  }
  return null;
}

export function resetBinary() {
  resolvedBinary = null;
}

// Run himalaya with the global `--json` flag and parse the result. Himalaya
// reports failures as a JSON object with an `error` key (still on stdout), so
// we surface those too.
async function runJSON(bin, args, opts = {}) {
  let res;
  try {
    res = await muxy.exec([bin, "--json", ...args], { timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT });
  } catch (err) {
    throw new HimalayaError(err?.message || `Failed to run ${bin}`, {});
  }

  const text = (res.stdout || "").trim();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (parsed && typeof parsed === "object" && parsed.error) {
    const detail = [parsed.error, ...(parsed.sources || [])].filter(Boolean).join(": ");
    throw new HimalayaError(detail || "Himalaya reported an error", res);
  }
  if (res.exitCode !== 0 && parsed === null) {
    const detail = (res.stderr || res.stdout || "").trim();
    throw new HimalayaError(detail || `himalaya exited with code ${res.exitCode}`, res);
  }
  return parsed;
}

// Run himalaya for its human-rendered plain-text output (used for reading a
// message body, which has no stable JSON shape) or for mutating actions where
// we only care that the command succeeded.
async function runText(bin, args, opts = {}) {
  let res;
  try {
    res = await muxy.exec([bin, ...args], { timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT });
  } catch (err) {
    throw new HimalayaError(err?.message || `Failed to run ${bin}`, {});
  }
  if (res.exitCode !== 0) {
    const detail = (res.stderr || res.stdout || "").trim();
    throw new HimalayaError(detail || `himalaya exited with code ${res.exitCode}`, res);
  }
  return res.stdout || "";
}

function accountArgs(account) {
  return account ? ["--account", account] : [];
}

export function createClient({ binary, account } = {}) {
  let bin = null;

  async function ensureBin() {
    if (bin) return bin;
    bin = await resolveBinary(binary);
    if (!bin) {
      throw new HimalayaMissingError(
        "Himalaya was not found. Install it, or set its path in the extension settings.",
      );
    }
    return bin;
  }

  return {
    async accounts() {
      const b = await ensureBin();
      const data = await runJSON(b, ["account", "list"]);
      return data?.accounts || [];
    },

    async mailboxes({ counts = false } = {}) {
      const b = await ensureBin();
      const args = ["mailbox", "list", ...accountArgs(account)];
      if (counts) args.push("--counts");
      const data = await runJSON(b, args);
      return data?.mailboxes || [];
    },

    async envelopes({ mailbox, page = 1, pageSize } = {}) {
      const b = await ensureBin();
      const args = ["envelope", "list", ...accountArgs(account), "--page", String(page)];
      if (mailbox) args.push("--mailbox", mailbox);
      if (pageSize) args.push("--page-size", String(pageSize));
      const data = await runJSON(b, args, { timeoutMs: 45000 });
      return data?.envelopes || [];
    },

    async readMessage({ id, mailbox } = {}) {
      const b = await ensureBin();
      const args = ["message", "read", ...accountArgs(account), String(id)];
      if (mailbox) args.push("--mailbox", mailbox);
      return runText(b, args, { timeoutMs: 45000 });
    },

    // The raw RFC 5322 bytes, for extracting the HTML part ourselves.
    async readRaw({ id, mailbox } = {}) {
      const b = await ensureBin();
      const args = ["message", "read", "--raw", ...accountArgs(account), String(id)];
      if (mailbox) args.push("--mailbox", mailbox);
      return runText(b, args, { timeoutMs: 45000 });
    },

    // Move message(s) from one mailbox to another (also how "archive" works).
    async move({ ids, from, to } = {}) {
      const b = await ensureBin();
      const args = ["message", "move", ...accountArgs(account), "--to", to];
      if (from) args.push("--from", from);
      args.push(...ids.map(String));
      return runText(b, args);
    },

    async copy({ ids, from, to } = {}) {
      const b = await ensureBin();
      const args = ["message", "copy", ...accountArgs(account), "--to", to];
      if (from) args.push("--from", from);
      args.push(...ids.map(String));
      return runText(b, args);
    },

    // Delete message(s) — on IMAP this moves them to the Trash folder.
    async remove({ ids, mailbox } = {}) {
      const b = await ensureBin();
      const args = ["message", "delete", ...accountArgs(account)];
      if (mailbox) args.push("--mailbox", mailbox);
      args.push(...ids.map(String));
      return runText(b, args);
    },

    // Add or remove a flag (e.g. "Seen", "Flagged") on message(s).
    async setFlag({ ids, mailbox, flag, on } = {}) {
      const b = await ensureBin();
      const verb = on ? "add" : "remove";
      const args = ["flag", verb, ...accountArgs(account), "--flag", flag];
      if (mailbox) args.push("--mailbox", mailbox);
      args.push(...ids.map(String));
      return runText(b, args);
    },
  };
}
