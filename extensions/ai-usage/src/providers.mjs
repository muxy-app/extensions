export const providerCatalog = [
  { id: "amp", name: "Amp", icon: "amp", integrated: false },
  { id: "claude", name: "Claude Code", icon: "claude", integrated: true },
  { id: "codex", name: "Codex", icon: "codex", integrated: true },
  { id: "copilot", name: "Copilot", icon: "copilot", integrated: false },
  { id: "cursor", name: "Cursor", icon: "cursor", integrated: true },
  { id: "factory", name: "Factory", icon: "factory", integrated: false },
  { id: "grok", name: "Grok", icon: "grok", integrated: false },
  { id: "opencode-go", name: "OpenCode Go", icon: "opencode-go", integrated: false },
  { id: "kimi", name: "Kimi", icon: "kimi", integrated: false },
  { id: "minimax", name: "MiniMax", icon: "minimax", integrated: false },
  { id: "zai", name: "Z.ai", icon: "zai", integrated: false }
];

export function canonicalProviderID(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "claude_code" ? "claude" : normalized;
}

export function defaultPreferences() {
  return {
    enabled: true,
    displayMode: "used",
    autoRefreshSeconds: 300,
    includeSecondary: false,
    pinnedPreview: "",
    trackedProviderIDs: new Set(providerCatalog.map((provider) => provider.id)),
    enabledProviderIDs: new Set(providerCatalog.map((provider) => provider.id))
  };
}
