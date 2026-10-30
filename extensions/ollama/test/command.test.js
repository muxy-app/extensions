import { strict as assert } from "node:assert";
import test from "node:test";
import { execSync } from "node:child_process";

import {
  buildLaunchCommand,
  curlExitReason,
  hostLabel,
  isMissingBinary,
  normalizeBaseUrl,
  shellQuote,
} from "../src/lib/ollama.js";

test("builds the documented launch command", () => {
  const command = buildLaunchCommand({
    url: "http://192.168.1.49:11434",
    agent: "claude",
    model: "qwen3.8-128k:latest",
  });

  assert.equal(
    command,
    "OLLAMA_HOST='http://192.168.1.49:11434' ollama launch 'claude' --model 'qwen3.8-128k:latest'",
  );
});

test("omits --model when no model is selected", () => {
  const command = buildLaunchCommand({ url: "http://127.0.0.1:11434", agent: "codex" });
  assert.equal(command, "OLLAMA_HOST='http://127.0.0.1:11434' ollama launch 'codex'");
});

test("passes extra args verbatim after a -- separator", () => {
  const command = buildLaunchCommand({
    url: "http://127.0.0.1:11434",
    agent: "codex",
    model: "llama3:8b",
    extraArgs: "  --sandbox workspace-write  ",
  });

  assert.ok(command.endsWith("-- --sandbox workspace-write"));
});

test("escapes embedded single quotes so the shell cannot break out", () => {
  const model = "evil'; rm -rf /; echo '";
  const command = buildLaunchCommand({ url: "http://127.0.0.1:11434", agent: "claude", model });

  const argv = execSync(`printf '%s\\n' ${command.slice(command.indexOf("--model") + 8)}`, {
    encoding: "utf8",
  });
  assert.equal(argv.trimEnd(), model);
});

test("shellQuote round-trips quotes", () => {
  assert.equal(shellQuote("plain"), "'plain'");
  assert.equal(shellQuote("it's"), "'it'\\''s'");
});

test("normalizes urls, adding a scheme and trimming trailing slashes", () => {
  assert.equal(normalizeBaseUrl("192.168.1.49:11434"), "http://192.168.1.49:11434");
  assert.equal(normalizeBaseUrl("http://127.0.0.1:11434/"), "http://127.0.0.1:11434");
  assert.equal(normalizeBaseUrl("  https://ollama.example.com/api/  "), "https://ollama.example.com/api");
});

test("rejects unusable urls", () => {
  assert.equal(normalizeBaseUrl(""), null);
  assert.equal(normalizeBaseUrl("   "), null);
  assert.equal(normalizeBaseUrl("ftp://example.com"), null);
  assert.equal(normalizeBaseUrl("http://"), null);
});

test("derives a host label for default server names", () => {
  assert.equal(hostLabel("http://192.168.1.49:11434"), "192.168.1.49:11434");
  assert.equal(hostLabel("not a url"), "not a url");
});

test("distinguishes a missing binary from a denied consent", () => {
  assert.equal(isMissingBinary("exec failed to launch: no such file"), true);
  assert.equal(isMissingBinary("command not found"), true);
  assert.equal(isMissingBinary("user denied consent"), false);
  assert.equal(isMissingBinary("permission denied (commands:exec)"), false);
});

test("maps curl exit codes to readable reasons", () => {
  assert.equal(curlExitReason(7), "connection refused");
  assert.equal(curlExitReason(28), "timed out");
  assert.equal(curlExitReason(99), "curl exit 99");
});
