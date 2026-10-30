import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

import { parseIntegrations, parseModels, formatBytes, filterModels } from "../src/lib/ollama.js";

const here = dirname(fileURLToPath(import.meta.url));
const help = readFileSync(join(here, "fixtures", "launch-help.txt"), "utf8");

test("parses every integration from real ollama launch --help", () => {
  const agents = parseIntegrations(help);
  const names = agents.map((agent) => agent.name);

  assert.equal(agents.length, 18);
  assert.ok(names.includes("claude"));
  assert.ok(names.includes("opencode"));
  assert.ok(names.includes("vscode"));
  assert.equal(agents[0].name, "claude");
  assert.equal(agents[0].label, "Claude Code");
  assert.deepEqual(agents[0].aliases, []);
});

test("extracts plural aliases and strips them from the label", () => {
  const chatgpt = parseIntegrations(help).find((agent) => agent.name === "chatgpt");
  assert.equal(chatgpt.label, "ChatGPT");
  assert.deepEqual(chatgpt.aliases, ["codex-app", "codex-desktop", "codex-gui"]);
});

test("extracts a singular alias", () => {
  const dsh = parseIntegrations(help).find((agent) => agent.name === "dsh");
  assert.equal(dsh.label, "DeepSeek Harness");
  assert.deepEqual(dsh.aliases, ["deepseek-harness"]);
});

test("stops at the Examples block and ignores flags", () => {
  const names = parseIntegrations(help).map((agent) => agent.name);
  assert.ok(!names.includes("Examples:"));
  assert.ok(!names.some((name) => name.startsWith("-")));
});

test("returns empty for unrecognised help output", () => {
  assert.deepEqual(parseIntegrations("usage: ollama\n  no integrations here"), []);
  assert.deepEqual(parseIntegrations(""), []);
  assert.deepEqual(parseIntegrations(null), []);
});

test("parses single-space separators", () => {
  const agents = parseIntegrations("Supported integrations:\n  claude Claude Code\n  chatgpt ChatGPT");
  assert.equal(agents.length, 2);
  assert.equal(agents[0].name, "claude");
  assert.equal(agents[0].label, "Claude Code");
  assert.equal(agents[1].name, "chatgpt");
  assert.equal(agents[1].label, "ChatGPT");
});

test("skips blank and stray indented lines without truncating the list", () => {
  const input = [
    "Supported integrations:",
    "",
    "  claude Claude Code",
    "  # a stray note that is not an integration",
    "  chatgpt ChatGPT",
  ].join("\n");
  const names = parseIntegrations(input).map((agent) => agent.name);
  assert.deepEqual(names, ["claude", "chatgpt"]);
});

test("still stops at the first non-indented block after the region", () => {
  const input = [
    "Supported integrations:",
    "  claude Claude Code",
    "Examples:",
    "  ollama launch",
  ].join("\n");
  const names = parseIntegrations(input).map((agent) => agent.name);
  assert.deepEqual(names, ["claude"]);
});

test("keeps a label that has no matching alias group", () => {
  const agents = parseIntegrations("Supported integrations:\n  droid Droid (beta)");
  assert.equal(agents[0].name, "droid");
  assert.equal(agents[0].label, "Droid (beta)");
  assert.deepEqual(agents[0].aliases, []);
});

test("parses and sorts models from /api/tags", () => {
  const payload = JSON.stringify({
    models: [
      { name: "qwen3.8-128k:latest", size: 20_500_000_000, details: { parameter_size: "35B", quantization_level: "Q4_K_M" } },
      { name: "llama3:8b", size: 4_700_000_000, details: { parameter_size: "8B", quantization_level: "Q4_0" } },
      { name: "", size: 1 },
    ],
  });
  const models = parseModels(payload);

  assert.equal(models.length, 2);
  assert.equal(models[0].name, "llama3:8b");
  assert.equal(models[1].parameterSize, "35B");
  assert.equal(models[1].quantization, "Q4_K_M");
});

test("tolerates malformed tag payloads", () => {
  assert.deepEqual(parseModels("not json"), []);
  assert.deepEqual(parseModels(JSON.stringify({ models: null })), []);
});

test("formats byte sizes", () => {
  assert.equal(formatBytes(0), "");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(4_700_000_000), "4.4 GB");
});

test("filters models case-insensitively", () => {
  const models = [{ name: "qwen3.8-128k:latest" }, { name: "llama3:8b" }];
  assert.equal(filterModels(models, "QWEN").length, 1);
  assert.equal(filterModels(models, "").length, 2);
});
