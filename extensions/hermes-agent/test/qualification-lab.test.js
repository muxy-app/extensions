import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { capture, qualifyRelease, validateNativeResult } from "../scripts/qualify-release.mjs";

const compose = await readFile(new URL("../qualification/docker-compose.yml", import.meta.url), "utf8");
const runner = await readFile(new URL("../scripts/qualify-release.mjs", import.meta.url), "utf8");

test("qualification images are pinned by immutable digest with recorded versions", () => {
  for (const digest of [
    "f8f548d87d16634d1ad9e3777280f3f577ba2358703f04e18e74007ffd3621bf",
    "96b9a4d3b5106746d08d43a6911650d4d21f7d5c7f2ac9660e792bdb5e63157c",
    "0aa26e284f05e6c77ae375b8c9c11d9eb6a448fb7bcd8d40f31cb6176189eb38",
  ]) assert.match(compose, new RegExp(`@sha256:${digest}`));
  assert.doesNotMatch(compose, /image:\s*[^\n]*:latest/);
  assert.match(compose, /OpenSSH 10\.3_p1-r0-ls233/);
  assert.match(compose, /cloudflared 2026\.8\.2/);
});

test("lab uses task-local secrets, OS-assigned loopback ports, real health checks, and actual SSH forwarding", () => {
  assert.match(runner, /mkdtemp\(join\(tmpdir\(\), "hermes-agent-qualification-"\)\)/);
  assert.match(runner, /chmod\(taskRoot, 0o700\)/);
  assert.match(runner, /hash_password\(sys\.stdin\.read\(\)\.strip\(\)\)/);
  assert.match(runner, /context_length: 65536/);
  assert.match(runner, /ssh-keygen/);
  assert.match(runner, /ssh_host_ed25519_key\.pub/);
  assert.match(runner, /StrictHostKeyChecking=yes/);
  assert.match(runner, /UserKnownHostsFile=\$\{state\.knownHostsPath\}/);
  assert.doesNotMatch(runner, /StrictHostKeyChecking=no/);
  assert.match(runner, /AllowTcpForwarding local/);
  assert.match(runner, /PermitOpen hermes:9119/);
  assert.match(compose, /127\.0\.0\.1::9119/);
  assert.match(compose, /127\.0\.0\.1::2222/);
  assert.match(runner, /"-L", `127\.0\.0\.1:\$\{localPort\}:hermes:9119`/);
  assert.match(runner, /ssh_internal_health/);
  assert.match(runner, /kanban", "boards", "create", "marketplace-beta"/);
  assert.match(runner, /kanban", "boards", "create", "marketplace-secondary"/);
  assert.match(runner, /"hermes", "cron", "create"/);
  assert.match(runner, /operations\.jobs\.length, 12/);
  assert.match(runner, /kanban\.updateStatus\(task\.id, "done"\)/);
  assert.match(runner, /new DashboardAgentController/);
  assert.match(runner, /streamedUpdates >= 2/);
  assert.match(runner, /`\$\{topology\}_agent_stream_completion`/);
  assert.match(runner, /gateway\.socket\.close\(4000, "qualification interruption"\)/);
  assert.match(runner, /ticketCount >= 2/);
  assert.match(runner, /pendingApproval\?\.choices\.includes\("once"\)/);
  assert.match(runner, /agent\.steer\("Continue the qualification without accessing external data\."\)/);
  assert.match(runner, /waitForSessionStopped/);
  assert.match(runner, /Agent Running:\\s\*No/);
  assert.match(runner, /Agent Running:\\s\*Yes/);
  assert.match(runner, /stopAcknowledgement\?\.status, "interrupted"/);
  assert.match(runner, /`\$\{topology\}_authoritative_cancellation`/);
  assert.match(runner, /mode: manual/);
  assert.match(compose + runner, /hermes-agent-qualification-empty/);
  assert.match(runner, /waitHttp\(`\$\{httpsUrl\}\/api\/status`/);
  assert.match(runner, /waitDnsPublication\(new URL\(httpsUrl\)\.hostname\)/);
  assert.match(runner, /\["\+short", "@1\.1\.1\.1", hostname, "A"\]/);
  assert.match(runner, /publicAddresses\.every\(\(address\) => isIP\(address\) === 4\)/);
  assert.match(runner, /lookup\(hostname\)/);
  assert.match(runner, /compose_network_health/);
  assert.match(compose, /"--http-host-header", "hermes"/);
  assert.doesNotMatch(compose, /HERMES_DASHBOARD_BASIC_AUTH_PASSWORD:/);
});

test("health failures retain only bounded status or transport diagnostics", () => {
  assert.match(runner, /lastFailure = `http_\$\{response\.status\}`/);
  assert.match(runner, /\^\[A-Z0-9_\]\{1,40\}\$/);
  assert.match(runner, /`\$\{label\}_timeout:\$\{lastFailure\}`/);
});

test("Quick Tunnel discovery accepts only generated four-word hostnames", () => {
  assert.match(runner, /\(\?:-\[a-z0-9\]\+\)\{3\}/);
  assert.match(runner, /candidates\.at\(-1\)/);
});

test("cleanup proves resource absence and retained receipts exclude raw credentials and endpoints", () => {
  for (const proof of ["cleanup_containers", "cleanup_networks", "cleanup_volumes", "listenersClosed", "rootRemoved", "sshProcessStopped"]) {
    assert.match(runner, new RegExp(proof));
  }
  assert.match(runner, /endpointDigests/);
  const receiptBlock = runner.slice(runner.indexOf("const receipt = Object.freeze"), runner.indexOf("const path = resolve", runner.indexOf("const receipt = Object.freeze")));
  assert.doesNotMatch(receiptBlock, /password|sessionSecret|httpsUrl|taskRoot|keyPath/);
});

test("capture force-kills a child that ignores its bounded termination window", async () => {
  const result = await capture(process.execPath, [
    "-e",
    "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)",
  ], { timeoutMs: 250, terminateGraceMs: 100, label: "uncooperative_fixture" });
  assert.equal(result.timedOut, true);
  assert.equal(result.signal, "SIGKILL");
});

test("manual native observations require the exact Muxy tuple, claims, categories, and real screenshot metadata", () => {
  const categories = [
    "accessibility_labels", "actual_muxy_ssh_workspace", "keyboard_focus", "muxy_restart",
    "muxy_webkit_https", "native_dark", "native_light", "pane_narrow", "pane_wide",
    "real_marketplace_screenshots", "reduced_motion", "remote_secret_absent",
    "remote_workspace_path_absent", "scale_default", "scale_large",
    "per_project_board_mapping",
  ];
  const state = { taskId: "fixture", challenge: "challenge" };
  const screenshot = (path) => ({ path, sha256: "a".repeat(64), width: 1600, height: 1000 });
  const valid = {
    schema: "hermes-agent-native-observation-v1",
    task: "fixture",
    challengeDigest: "2dd00bd77e0222ced882665481a9c1d9f907309d16e05ed007a1ea63928477a9",
    muxyVersion: "1.5.0 (945)",
    categories,
    claims: { privacyScan: true, workspacePathAbsent: true, remoteSecretAbsent: true },
    screenshots: {
      operations: screenshot("assets/screenshots/screenshot-2.png"),
      agentApproval: screenshot("assets/screenshots/screenshot-3.png"),
      projectBoard: screenshot("assets/screenshots/screenshot-4.png"),
    },
  };
  assert.equal(validateNativeResult(state, valid).muxyVersion, "1.5.0 (945)");
  assert.throws(() => validateNativeResult(state, { ...valid, muxyVersion: "1.5.1" }));
  assert.throws(() => validateNativeResult(state, { ...valid, claims: { ...valid.claims, privacyScan: false } }));
});

test("supported beta qualification passes while optional native diagnostics remain non-release evidence", () => {
  assert.match(runner, /passed_supported_beta_matrix/);
  assert.match(runner, /manual_native_evidence_recorded_release_blocked/);
  assert.match(runner, /native_evidence_not_muxy_attested/);
});

function controlFlowHarness({ initializeError = null, cleanupResult = null } = {}) {
  const calls = [];
  const receipts = [];
  const clean = cleanupResult ?? {
    containers: 0,
    networks: 0,
    volumes: 0,
    dockerProof: true,
    listenersClosed: true,
    rootRemoved: true,
    sshProcessStopped: true,
  };
  return {
    calls,
    receipts,
    hooks: {
      createState: () => ({ taskId: "fixture", categories: new Set(), nativeEvidence: null }),
      initialize: async () => {
        calls.push("initialize");
        if (initializeError) throw initializeError;
      },
      start: async () => { calls.push("start"); return {}; },
      automate: async () => { calls.push("automate"); },
      hold: async () => { calls.push("hold"); },
      cleanup: async () => { calls.push("cleanup"); return clean; },
      writeReceipt: async (_state, verdict, cleanup, failureCode) => {
        calls.push("receipt");
        receipts.push({ verdict, cleanup, failureCode });
        return "/receipt.json";
      },
      log: () => {},
    },
  };
}

test("qualification control flow passes the supported beta matrix only after success and proven cleanup", async () => {
  const harness = controlFlowHarness();
  const result = await qualifyRelease({ testHooks: harness.hooks });
  assert.equal(result.verdict, "passed_supported_beta_matrix");
  assert.deepEqual(harness.calls, ["initialize", "start", "automate", "cleanup", "receipt"]);
  assert.deepEqual(harness.receipts.map(({ verdict, failureCode }) => ({ verdict, failureCode })), [
    { verdict: "passed_supported_beta_matrix", failureCode: null },
  ]);
});

test("qualification control flow records manual observations but rejects release passage", async () => {
  const harness = controlFlowHarness();
  await assert.rejects(
    qualifyRelease({ nativeHold: true, testHooks: harness.hooks }),
    /native_evidence_not_muxy_attested/,
  );
  assert.deepEqual(harness.calls, ["initialize", "start", "automate", "hold", "cleanup", "receipt"]);
  assert.deepEqual(harness.receipts.map(({ verdict, failureCode }) => ({ verdict, failureCode })), [
    { verdict: "manual_native_evidence_recorded_release_blocked", failureCode: "native_evidence_not_muxy_attested" },
  ]);
});

test("qualification control flow cleans partial setup and fails closed on cleanup proof failure", async () => {
  const setupFailure = controlFlowHarness({ initializeError: new Error("fixture_setup_failed") });
  await assert.rejects(qualifyRelease({ testHooks: setupFailure.hooks }), /fixture_setup_failed/);
  assert.deepEqual(setupFailure.calls, ["initialize", "cleanup", "receipt"]);
  assert.equal(setupFailure.receipts[0].verdict, "failed");
  assert.equal(setupFailure.receipts[0].failureCode, "fixture_setup_failed");

  const cleanupFailure = controlFlowHarness({
    cleanupResult: {
      containers: 1,
      networks: 0,
      volumes: 0,
      dockerProof: false,
      listenersClosed: true,
      rootRemoved: true,
      sshProcessStopped: true,
    },
  });
  await assert.rejects(qualifyRelease({ testHooks: cleanupFailure.hooks }), /cleanup_failed/);
  assert.equal(cleanupFailure.receipts[0].verdict, "cleanup_failed");
});
