import { listGrok } from "./grok.js";
import { listCursor } from "./cursor.js";
import { listClaude } from "./claude.js";
import { listCodex } from "./codex.js";
import { listCopilot } from "./copilot.js";
import { listOpenCode } from "./opencode.js";
import { toPromise } from "./helpers.js";
import { hasSqlite3 } from "../../host-fs.js";

/**
 * List sessions for one CLI using pure JS + host-fs.
 * Returns a plain array when host-fs is sync (runScript), or a Promise when
 * exec is async (panel). Callers that always await should use toPromise().
 * @param {*} fs  createHostFs instance
 * @param {string} cli
 * @param {string} cwd
 * @param {{ sqliteAvailable?: boolean, home?: string }} [opts]
 */
export function listSessionsJs(fs, cli, cwd, opts = {}) {
  const id = String(cli || "").toLowerCase();
  // Callers (scan.js façade, resume-picker) should pass sqliteAvailable after probing.
  // Default true so fixture tests with real sqlite work without an exec probe.
  const sqliteAvailable = opts.sqliteAvailable !== false;

  switch (id) {
    case "grok":
      return listGrok(fs, cwd, opts);
    case "cursor":
      return listCursor(fs, cwd, opts);
    case "claude":
      return listClaude(fs, cwd, opts);
    case "codex":
      return listCodex(fs, cwd, { ...opts, sqliteAvailable });
    case "copilot":
      return listCopilot(fs, cwd, { ...opts, sqliteAvailable });
    case "opencode":
      return listOpenCode(fs, cwd, { ...opts, sqliteAvailable });
    default:
      throw new Error(`unknown cli: ${cli}`);
  }
}

/**
 * Probe sqlite availability via the same exec used for host-fs.
 * @param {Function} exec
 */
export async function probeSqlite(exec) {
  return Boolean(await toPromise(hasSqlite3(exec)));
}
