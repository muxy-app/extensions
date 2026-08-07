/** Canonical provider registry (Muxy-aligned ids). */

export const PROVIDERS = [
  {
    id: "grok",
    displayName: "Grok",
    binary: "grok",
    binaries: ["grok"],
    capabilities: { rename: true, delete: true },
  },
  {
    id: "claude",
    displayName: "Claude",
    binary: "claude",
    binaries: ["claude"],
    capabilities: { rename: false, delete: true },
  },
  {
    id: "codex",
    displayName: "Codex",
    binary: "codex",
    binaries: ["codex"],
    capabilities: { rename: true, delete: false },
  },
  {
    id: "copilot",
    displayName: "Copilot",
    binary: "copilot",
    binaries: ["copilot"],
    capabilities: { rename: true, delete: false },
  },
  {
    id: "cursor",
    displayName: "Cursor",
    binary: "cursor-agent",
    binaries: ["cursor-agent", "cursor"],
    capabilities: { rename: true, delete: true },
  },
  {
    id: "opencode",
    displayName: "OpenCode",
    binary: "opencode",
    binaries: ["opencode"],
    capabilities: { rename: true, delete: true },
  },
];

/** Preference order for "Start new" when preferredCli is missing. */
export const START_PREFERENCE = [
  "grok",
  "claude",
  "codex",
  "copilot",
  "cursor",
  "opencode",
];

export function providerById(id) {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}
