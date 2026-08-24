import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { connect, createServer, isIP } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { pathToFileURL } from "node:url";

import { CurlRelay } from "../src/curl-relay.js";
import { DashboardAgentController } from "../src/dashboard-agent.js";
import { DashboardAuthSession } from "../src/dashboard-auth.js";
import { buildDashboardWebSocketUrl, DashboardGatewayClient } from "../src/dashboard-gateway.js";
import { DashboardOperationsClient } from "../src/dashboard-operations.js";
import { KanbanClient } from "../src/kanban-client.js";

const root = resolve(import.meta.dirname, "..");
const composeFile = resolve(root, "qualification/docker-compose.yml");
const activeFile = resolve(root, ".qualification/active.json");
const receiptDirectory = resolve(root, ".qualification/receipts");
const HERMES_IMAGE = "nousresearch/hermes-agent:v2026.8.16@sha256:f8f548d87d16634d1ad9e3777280f3f577ba2358703f04e18e74007ffd3621bf";
const VERSION_RECORD = Object.freeze({
  hermes: "0.20.2 (2026.8.16)@sha256:f8f548d87d16634d1ad9e3777280f3f577ba2358703f04e18e74007ffd3621bf",
  sshd: "10.3_p1-r0-ls233@sha256:96b9a4d3b5106746d08d43a6911650d4d21f7d5c7f2ac9660e792bdb5e63157c",
  cloudflared: "2026.8.2@sha256:0aa26e284f05e6c77ae375b8c9c11d9eb6a448fb7bcd8d40f31cb6176189eb38",
});
const REQUIRED_NATIVE_CATEGORIES = Object.freeze([
  "accessibility_labels",
  "actual_muxy_ssh_workspace",
  "keyboard_focus",
  "muxy_restart",
  "muxy_webkit_https",
  "native_dark",
  "native_light",
  "pane_narrow",
  "pane_wide",
  "per_project_board_mapping",
  "real_marketplace_screenshots",
  "reduced_motion",
  "remote_secret_absent",
  "remote_workspace_path_absent",
  "scale_default",
  "scale_large",
]);
const REQUIRED_SCREENSHOTS = Object.freeze({
  operations: "assets/screenshots/screenshot-2.png",
  agentApproval: "assets/screenshots/screenshot-3.png",
  projectBoard: "assets/screenshots/screenshot-4.png",
});

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function signBasicFixtureToken(state, kind, expiresAt) {
  const raw = Buffer.from(JSON.stringify({ sub: "muxy", kind, exp: expiresAt }));
  const signature = createHmac("sha256", Buffer.from(state.sessionSecret, "base64")).update(raw).digest();
  return Buffer.concat([raw, signature]).toString("base64url");
}

function replaceSessionCookie(session, suffix, value) {
  return Object.freeze({
    ...session,
    cookies: Object.freeze(session.cookies.map(([name, current]) => Object.freeze([
      name,
      name.endsWith(suffix) ? value : current,
    ]))),
  });
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export async function capture(command, args, { cwd = root, env = process.env, input = "", timeoutMs = 120_000, terminateGraceMs = 3_000, label = "command" } = {}) {
  return new Promise((resolveCapture, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    let forceTimer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceTimer = setTimeout(() => child.kill("SIGKILL"), terminateGraceMs);
    }, timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", () => {
      clearTimeout(timer);
      if (forceTimer !== null) clearTimeout(forceTimer);
      reject(new Error(`${label}_launch_failed`));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (forceTimer !== null) clearTimeout(forceTimer);
      resolveCapture(Object.freeze({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode: code,
        signal,
        timedOut,
        truncated: false,
      }));
    });
    child.stdin.end(input);
  });
}

async function checked(command, args, options = {}) {
  const result = await capture(command, args, options);
  if (result.timedOut) throw new Error(`${options.label ?? "command"}_timeout`);
  if (result.exitCode !== 0) throw new Error(`${options.label ?? "command"}_failed:${result.exitCode ?? "signal"}`);
  return result;
}

async function freePort() {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((resolveClose) => listener.close(resolveClose));
  return port;
}

async function portClosed(port) {
  return new Promise((resolveClosed) => {
    const socket = connect({ host: "127.0.0.1", port });
    const done = (value) => { socket.destroy(); resolveClosed(value); };
    socket.setTimeout(500, () => done(true));
    socket.once("error", () => done(true));
    socket.once("connect", () => done(false));
  });
}

async function waitHttp(url, { timeoutMs = 150_000, label = "http_health" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastFailure = "no_response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return response;
      lastFailure = `http_${response.status}`;
      await response.body?.cancel().catch(() => {});
    } catch (error) {
      const code = error?.cause?.code;
      lastFailure = typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code)
        ? code.toLowerCase()
        : error?.name === "TimeoutError"
          ? "request_timeout"
          : "network_error";
    }
    await delay(1_000);
  }
  throw new Error(`${label}_timeout:${lastFailure}`);
}

async function waitDnsPublication(hostname, { timeoutMs = 120_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastFailure = "dns_unpublished";
  while (Date.now() < deadline) {
    try {
      const publicLookup = await capture("dig", ["+short", "@1.1.1.1", hostname, "A"], {
        label: "public_dns_lookup",
        timeoutMs: 5_000,
      });
      const publicAddresses = publicLookup.stdout.trim().split(/\s+/).filter(Boolean);
      if (publicLookup.exitCode === 0 && publicAddresses.length > 0 && publicAddresses.every((address) => isIP(address) === 4)) {
        const systemAddress = await lookup(hostname);
        if (systemAddress.address) return;
      }
    } catch (error) {
      lastFailure = typeof error?.code === "string" && /^[A-Z0-9_]{1,40}$/.test(error.code)
        ? error.code.toLowerCase()
        : "dns_error";
    }
    await delay(1_000);
  }
  throw new Error(`https_edge_dns_timeout:${lastFailure}`);
}

function composeArgs(state, ...args) {
  return ["compose", "-f", composeFile, "-p", state.project, ...args];
}

async function compose(state, args, options = {}) {
  return checked("docker", composeArgs(state, ...args), {
    ...options,
    env: { ...process.env, ...state.composeEnvironment },
  });
}

async function composeCapture(state, args, options = {}) {
  return capture("docker", composeArgs(state, ...args), {
    ...options,
    env: { ...process.env, ...state.composeEnvironment },
  });
}

async function servicePort(state, service, internalPort) {
  const result = await compose(state, ["port", service, String(internalPort)], { label: `${service}_port` });
  const match = result.stdout.trim().match(/127\.0\.0\.1:(\d+)$/);
  if (!match) throw new Error(`${service}_port_contract_mismatch`);
  return Number(match[1]);
}

async function waitHealthy(state, service, timeoutMs = 150_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const id = (await compose(state, ["ps", "-q", service], { label: `${service}_id` })).stdout.trim();
    if (id) {
      const health = await checked("docker", ["inspect", "--format", "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}", id], { label: `${service}_inspect` });
      if (health.stdout.trim() === "healthy") return;
      if (["exited", "dead", "unhealthy"].includes(health.stdout.trim())) throw new Error(`${service}_unhealthy`);
    }
    await delay(1_000);
  }
  throw new Error(`${service}_health_timeout`);
}

async function quickTunnelUrl(state) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const logs = await composeCapture(state, ["logs", "--no-color", "--tail", "80", "cloudflared"], { label: "cloudflared_logs" });
    const candidates = [...`${logs.stdout}\n${logs.stderr}`.matchAll(/https:\/\/([a-z0-9]+(?:-[a-z0-9]+){3})\.trycloudflare\.com/gi)];
    if (candidates.length) return candidates.at(-1)[0];
    const status = await composeCapture(state, ["ps", "--status", "exited", "-q", "cloudflared"], { label: "cloudflared_status" });
    if (status.stdout.trim()) throw new Error("cloudflared_exited");
    await delay(1_000);
  }
  throw new Error("cloudflared_url_timeout");
}

async function assertComposeNetworkHealth(state) {
  const result = await compose(state, [
    "exec", "-T", "model-stub", "python3", "-c",
    "import json,urllib.request; r=json.load(urllib.request.urlopen('http://hermes:9119/api/status', timeout=5)); assert r.get('auth_required') is True",
  ], { label: "compose_network_health", timeoutMs: 20_000 });
  assert.equal(result.stderr.trim(), "");
  state.categories.add("compose_network_health");
}

async function seedSupportedSurfaces(state) {
  await compose(state, [
    "exec", "-T", "hermes", "hermes", "kanban", "boards", "create", "marketplace-beta",
    "--name", "Marketplace Beta", "--description", "Disposable qualification board", "--switch",
  ], { label: "kanban_board_seed", timeoutMs: 30_000 });
  await compose(state, [
    "exec", "-T", "hermes", "hermes", "kanban", "boards", "create", "marketplace-secondary",
    "--name", "Marketplace Secondary", "--description", "Disposable secondary qualification board",
  ], { label: "kanban_secondary_board_seed", timeoutMs: 30_000 });

  const tasks = [
    ["Confirm release permissions", "--triage"],
    ["Exercise password session rotation"],
    ["Review trusted HTTPS boundary", "--initial-status", "blocked"],
    ["Verify marketplace package assets"],
  ];
  for (const [title, ...args] of tasks) {
    await compose(state, [
      "exec", "-T", "hermes", "hermes", "kanban", "--board", "marketplace-beta", "create", title,
      "--workspace", "scratch", "--created-by", "qualification", ...args,
    ], { label: "kanban_task_seed", timeoutMs: 30_000 });
  }

  const jobs = [
    ["Fixture health", "15m"],
    ["Session rotation", "30m"],
    ["Operations refresh", "1h"],
    ["Board cleanup", "2h"],
    ["Daily security scan", "0 8 * * *"],
    ["Daily contract check", "0 9 * * *"],
    ["Weekday package check", "0 10 * * 1-5"],
    ["Monday release review", "0 11 * * 1"],
    ["Tuesday compatibility review", "0 12 * * 2"],
    ["Wednesday privacy review", "0 13 * * 3"],
    ["Thursday cleanup proof", "0 14 * * 4"],
    ["Friday beta report", "0 15 * * 5"],
  ];
  for (const [name, schedule] of jobs) {
    await compose(state, [
      "exec", "-T", "hermes", "hermes", "cron", "create", schedule,
      "Qualification fixture only. Do not access external data.", "--name", name,
    ], { label: "cron_job_seed", timeoutMs: 30_000 });
  }
  state.categories.add("supported_surface_seeding");
}

function createBootstrapState() {
  const taskId = randomBytes(6).toString("hex");
  return {
    taskId,
    taskRoot: null,
    project: `hermesqual${taskId}`,
    password: "",
    sessionSecret: "",
    challenge: "",
    keyPath: "",
    knownHostsPath: "",
    composeEnvironment: {},
    composeStarted: false,
    ports: [],
    sshTunnel: null,
    categories: new Set(),
    endpointDigests: {},
    nativeEvidence: null,
  };
}

async function initializeTaskState(state) {
  const taskRoot = await mkdtemp(join(tmpdir(), "hermes-agent-qualification-"));
  state.taskRoot = taskRoot;
  await chmod(taskRoot, 0o700);
  await Promise.all([
    mkdir(join(taskRoot, "hermes"), { recursive: true, mode: 0o700 }),
    mkdir(join(taskRoot, "sshd"), { recursive: true, mode: 0o700 }),
    mkdir(join(taskRoot, "sshd/sshd/sshd_config.d"), { recursive: true, mode: 0o700 }),
    mkdir(join(taskRoot, "keys"), { recursive: true, mode: 0o700 }),
    mkdir(join(taskRoot, "verifier"), { recursive: true, mode: 0o700 }),
  ]);

  const { taskId, project } = state;
  const password = randomBytes(24).toString("base64url");
  const sessionSecret = randomBytes(48).toString("base64");
  const challenge = randomBytes(32).toString("hex");
  const keyPath = join(taskRoot, "keys/muxy");
  const knownHostsPath = join(taskRoot, "keys/known_hosts");
  await checked("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", `hermes-qualification-${taskId}`, "-f", keyPath], { label: "ssh_keygen" });
  await writeFile(join(taskRoot, "verifier/challenge"), challenge, { mode: 0o600 });

  const hashResult = await checked("docker", [
    "run", "--rm", "-i", "--entrypoint", "python3", HERMES_IMAGE,
    "-c", "import sys; from plugins.dashboard_auth.basic import hash_password; print(hash_password(sys.stdin.read().strip()))",
  ], { input: password, label: "password_hash", timeoutMs: 60_000 });
  const passwordHash = hashResult.stdout.trim();
  if (!passwordHash || passwordHash.includes("\n")) throw new Error("password_hash_contract_mismatch");

  const config = [
    "_config_version: 12",
    "model:",
    "  default: hermes-agent-qualification",
    "  provider: custom",
    "  base_url: http://model-stub:8000/v1",
    "  api_key: qualification-fixture-not-a-secret",
    "  context_length: 65536",
    "agent:",
    "  max_iterations: 8",
    "approvals:",
    "  mode: manual",
    "  timeout: 120",
    "",
  ].join("\n");
  await writeFile(join(taskRoot, "hermes/config.yaml"), config, { mode: 0o600 });
  await writeFile(join(taskRoot, "sshd/sshd/sshd_config.d/99-qualification-forwarding.conf"), [
    "AllowTcpForwarding local",
    "PermitOpen hermes:9119",
    "GatewayPorts no",
    "",
  ].join("\n"), { mode: 0o600 });
  await writeFile(join(taskRoot, "secret.json"), JSON.stringify({ password }), { mode: 0o600 });

  Object.assign(state, {
    password,
    sessionSecret,
    challenge,
    keyPath,
    knownHostsPath,
    composeEnvironment: {
      QUAL_PROJECT: project,
      QUAL_ROOT: taskRoot,
      QUAL_PASSWORD_HASH: passwordHash,
      QUAL_SESSION_SECRET: sessionSecret,
    },
  });
  return state;
}

function relayExec(argv, options) {
  return capture(argv[0], argv.slice(1), { input: options?.stdin ?? "", timeoutMs: options?.timeoutMs ?? 20_000, label: "dashboard_request" });
}

async function websocketTicketAccepted(baseUrl, ticket) {
  return new Promise((resolveAccepted) => {
    let url = buildDashboardWebSocketUrl(baseUrl, ticket);
    const socket = new WebSocket(url);
    url = "";
    let settled = false;
    const finish = (accepted) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(1000, "qualification"); } catch { /* already closed */ }
      resolveAccepted(accepted);
    };
    const timer = setTimeout(() => finish(false), 12_000);
    socket.addEventListener("open", () => finish(true), { once: true });
    socket.addEventListener("error", () => finish(false), { once: true });
    socket.addEventListener("close", () => finish(false), { once: true });
  });
}

async function qualifyDashboard(baseUrl, state, { invalidPassword = false, topology, mutateBoard = false } = {}) {
  const relay = new CurlRelay({ exec: relayExec });
  const auth = new DashboardAuthSession({ baseUrl, relay });
  const discovered = await auth.discover();
  assert.equal(discovered.state, "logged_out");
  const provider = discovered.providers.find((item) => item.supportsPassword);
  assert.ok(provider);
  if (invalidPassword) {
    await assert.rejects(auth.login({ provider: provider.name, username: "muxy", password: `${state.password}-invalid` }), (error) => error.code === "invalid_credentials");
    state.categories.add("invalid_password");
  }
  await auth.login({ provider: provider.name, username: "muxy", password: state.password });
  const exported = auth.exportSession();
  assert.ok(exported && JSON.stringify(exported).includes(state.password) === false);

  const expiredAccess = signBasicFixtureToken(state, "access", Math.floor(Date.now() / 1000) - 60);
  const rotationFixture = replaceSessionCookie(exported, "hermes_session_at", expiredAccess);
  const rotating = DashboardAuthSession.fromSession({ baseUrl, session: rotationFixture, relay });
  const cookiesBeforeRotation = JSON.stringify(rotating.exportSession().cookies);
  await rotating.verify();
  const cookiesAfterRotation = JSON.stringify(rotating.exportSession().cookies);
  assert.notEqual(cookiesAfterRotation, cookiesBeforeRotation, "Hermes must rotate an expired access session from its refresh cookie");
  rotating.release();
  state.categories.add(`${topology}_cookie_rotation`);

  const expiredRefresh = signBasicFixtureToken(state, "refresh", Math.floor(Date.now() / 1000) - 60);
  const expiredFixture = replaceSessionCookie(rotationFixture, "hermes_session_rt", expiredRefresh);
  const expired = DashboardAuthSession.fromSession({ baseUrl, session: expiredFixture, relay });
  await assert.rejects(expired.verify(), (error) => error.code === "session_expired");
  expired.release();
  state.categories.add(`${topology}_expired_session`);

  const restored = DashboardAuthSession.fromSession({ baseUrl, session: exported, relay });
  await restored.verify();
  const first = await restored.requestWebSocketTicket();
  const second = await restored.requestWebSocketTicket();
  assert.notEqual(first.ticket, second.ticket);
  assert.equal(await websocketTicketAccepted(baseUrl, first.ticket), true);
  assert.equal(await websocketTicketAccepted(baseUrl, first.ticket), false, "a WebSocket ticket must be single-use");
  assert.equal(await websocketTicketAccepted(baseUrl, second.ticket), true);

  const missingPlugin = await restored.requestJson({ url: `${baseUrl}/api/plugins/qualification-missing` });
  assert.equal(missingPlugin.status, 404);
  state.categories.add(`${topology}_missing_optional_plugin`);
  await assert.rejects(restored.requestJson({ url: `${baseUrl}/` }), (error) => error.code === "relay_protocol_error");
  state.categories.add(`${topology}_malformed_response`);

  const operations = await new DashboardOperationsClient({
    baseUrl,
    session: restored,
    board: "marketplace-beta",
  }).load();
  assert.equal(operations.jobs.length, 12);
  assert.equal(operations.available.health, true);
  assert.equal(operations.available.jobs, true);
  assert.equal(operations.available.queue, true);

  const kanban = new KanbanClient({ baseUrl, session: restored, board: "marketplace-beta" });
  const catalog = await kanban.listBoards();
  assert.ok(catalog.boards.some((board) => board.slug === "marketplace-beta"));
  const board = await kanban.loadBoard();
  assert.ok(board.columns.some((column) => column.tasks.length > 0));
  if (mutateBoard) {
    const task = await kanban.createTask({
      title: "Move a disposable Dashboard task",
      idempotencyKey: `qualification-${state.taskId}`,
    });
    await kanban.updateStatus(task.id, "done");
    const updated = await kanban.loadBoard();
    assert.ok(updated.columns.find((column) => column.name === "done")?.tasks.some((item) => item.id === task.id));
    state.categories.add("board_create_move");
  }
  state.categories.add(`${topology}_operations_refresh`);
  state.categories.add(`${topology}_board_read`);
  restored.release();
  state.categories.add("password_login");
  state.categories.add("session_restore");
  state.categories.add("single_use_ws_ticket");
}

async function waitForAgent(agent, predicate, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate(agent.snapshot)) return agent.snapshot;
    await delay(50);
  }
  throw new Error(`${label}_timeout`);
}

async function waitForGateway(gateway, predicate, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate(gateway.snapshot)) return gateway.snapshot;
    await delay(50);
  }
  throw new Error(`${label}_timeout`);
}

async function qualifyAgentCompletion(baseUrl, state, topology) {
  const relay = new CurlRelay({ exec: relayExec });
  const auth = new DashboardAuthSession({ baseUrl, relay });
  const discovered = await auth.discover();
  const provider = discovered.providers.find((item) => item.supportsPassword);
  assert.ok(provider);
  await auth.login({ provider: provider.name, username: "muxy", password: state.password });
  const mintTicket = auth.requestWebSocketTicket.bind(auth);
  let ticketCount = 0;
  auth.requestWebSocketTicket = async () => {
    ticketCount += 1;
    return mintTicket();
  };
  const gateway = new DashboardGatewayClient({ authSession: auth, reconnectDelays: [100, 250, 500] });
  const agent = new DashboardAgentController({ gateway });
  let streamedUpdates = 0;
  let previousLength = 0;
  let observedOffline = false;
  const unsubscribeGateway = gateway.subscribe((snapshot) => {
    if (snapshot.state === "offline") observedOffline = true;
  });
  const unsubscribe = agent.subscribe((snapshot) => {
    if (snapshot.assistant.length > previousLength) streamedUpdates += 1;
    previousLength = snapshot.assistant.length;
  });
  try {
    await gateway.connect();
    await agent.start("Return the deterministic qualification response. Do not use tools.");
    const completed = await waitForAgent(agent, (snapshot) => snapshot.status === "completed", `${topology}_agent_completion`);
    assert.match(completed.assistant, /Hermes qualification stream complete\./);
    assert.ok(streamedUpdates >= 2, "the response must arrive through multiple streamed updates");
    gateway.socket.close(4000, "qualification interruption");
    await waitForGateway(gateway, (snapshot) => snapshot.state === "connected" && ticketCount >= 2, `${topology}_websocket_reconnect`);
    assert.equal(observedOffline, true);
    state.categories.add(`${topology}_agent_stream_completion`);
    state.categories.add(`${topology}_websocket_reconnect`);
  } finally {
    unsubscribeGateway();
    unsubscribe();
    agent.release();
    await gateway.disconnect();
    auth.release();
  }
}

async function waitForSessionStopped(gateway, sessionId, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await gateway.request("session.status", { session_id: sessionId });
    if (status?.running === false
      || ["interrupted", "stopped"].includes(status?.status)
      || (typeof status?.output === "string" && /(?:^|\n)Agent Running:\s*No(?:\n|$)/.test(status.output))) return status;
    await delay(100);
  }
  throw new Error(`${label}_timeout`);
}

async function waitForSessionRunning(gateway, sessionId, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await gateway.request("session.status", { session_id: sessionId });
    if (status?.running === true
      || (typeof status?.output === "string" && /(?:^|\n)Agent Running:\s*Yes(?:\n|$)/.test(status.output))) return status;
    await delay(100);
  }
  throw new Error(`${label}_timeout`);
}

async function qualifyAgentControls(baseUrl, state, topology) {
  const relay = new CurlRelay({ exec: relayExec });
  const auth = new DashboardAuthSession({ baseUrl, relay });
  const discovered = await auth.discover();
  const provider = discovered.providers.find((item) => item.supportsPassword);
  assert.ok(provider);
  await auth.login({ provider: provider.name, username: "muxy", password: state.password });
  const gateway = new DashboardGatewayClient({ authSession: auth, reconnectDelays: [100, 250, 500] });
  const agent = new DashboardAgentController({ gateway });
  try {
    await gateway.connect();
    await agent.start("QUALIFY_TOOL: perform only the supplied disposable qualification action.");
    const approval = await waitForAgent(agent, (snapshot) => snapshot.status === "waiting_for_approval", `${topology}_approval`);
    assert.ok(approval.pendingApproval?.choices.includes("once"));
    assert.match(approval.pendingApproval?.command ?? "", /hermes-agent-qualification-empty/);
    await agent.approve("once");
    const toolComplete = await waitForAgent(agent, (snapshot) => snapshot.status === "completed", `${topology}_tool_completion`);
    assert.ok(toolComplete.activity.some((item) => item.kind === "tool"));
    state.categories.add(`${topology}_one_time_approval`);
    state.categories.add(`${topology}_tool_activity`);

    assert.equal(agent.reset(), true);
    await agent.start("QUALIFY_SLOW: stream long enough to receive guidance and cancellation.");
    await waitForAgent(agent, (snapshot) => snapshot.status === "running" && snapshot.assistant.length > 0, `${topology}_slow_stream`);
    await agent.steer("Continue the qualification without accessing external data.");
    assert.ok(agent.snapshot.activity.some((item) => item.kind === "steer"));
    state.categories.add(`${topology}_guidance`);
    const active = gateway.getActiveSession();
    assert.ok(active?.runtimeId);
    await waitForSessionRunning(gateway, active.runtimeId, `${topology}_running_before_stop`);
    const stopAcknowledgement = await agent.stop();
    assert.equal(stopAcknowledgement?.status, "interrupted");
    await waitForSessionStopped(gateway, active.runtimeId, `${topology}_authoritative_cancellation`);
    state.categories.add(`${topology}_stop`);
    state.categories.add(`${topology}_authoritative_cancellation`);
  } finally {
    agent.release();
    await gateway.disconnect();
    auth.release();
  }
}

function sshClientArgs(state, sshPort) {
  if (!state.knownHostsPath) throw new Error("ssh_host_key_not_pinned");
  return [
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${state.knownHostsPath}`,
    "-o", "GlobalKnownHostsFile=/dev/null",
    "-i", state.keyPath,
    "-p", String(sshPort),
  ];
}

async function pinSshHostKey(state, sshPort) {
  const publicKeyPath = join(state.taskRoot, "sshd/ssh_host_keys/ssh_host_ed25519_key.pub");
  const fields = (await readFile(publicKeyPath, "utf8")).trim().split(/\s+/);
  if (fields[0] !== "ssh-ed25519" || !/^[A-Za-z0-9+/]{40,120}={0,2}$/.test(fields[1] ?? "")) {
    throw new Error("ssh_host_key_contract_mismatch");
  }
  await writeFile(state.knownHostsPath, `[127.0.0.1]:${sshPort} ${fields[0]} ${fields[1]}\n`, { mode: 0o600 });
  state.categories.add("ssh_host_key_pinned");
}

async function assertSshAuthAndInternalReachability(state, sshPort) {
  const result = await checked("ssh", [
    ...sshClientArgs(state, sshPort),
    "muxy@127.0.0.1",
    "/usr/bin/curl", "--silent", "--show-error", "--fail", "--max-time", "10", "http://hermes:9119/api/status",
  ], { label: "ssh_internal_health", timeoutMs: 20_000 });
  const body = JSON.parse(result.stdout);
  assert.equal(body.auth_required, true);
  state.categories.add("ssh_key_authentication");
  state.categories.add("ssh_container_hermes_reachability");
}

async function startSshForward(state, sshPort, hermesPort) {
  const localPort = await freePort();
  const args = [
    "-N",
    ...sshClientArgs(state, sshPort),
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=5",
    "-L", `127.0.0.1:${localPort}:hermes:9119`,
    "muxy@127.0.0.1",
  ];
  const child = spawn("ssh", args, { stdio: ["ignore", "ignore", "pipe"] });
  child.once("exit", () => { if (state.sshTunnel === child) state.sshTunnel = null; });
  state.sshTunnel = child;
  state.ports.push(localPort);
  await Promise.race([
    waitHttp(`http://127.0.0.1:${localPort}/api/status`, { timeoutMs: 30_000, label: "ssh_forward_health" }),
    once(child, "exit").then(([code]) => { throw new Error(`ssh_forward_process_exited:${code ?? "signal"}`); }),
  ]);
  assert.notEqual(localPort, hermesPort);
  state.categories.add("actual_ssh_forward");
  return `http://127.0.0.1:${localPort}`;
}

async function assertSshRemoteReachability(state, sshPort, httpsUrl) {
  const result = await checked("ssh", [
    ...sshClientArgs(state, sshPort),
    "muxy@127.0.0.1",
    "/usr/bin/curl", "--silent", "--show-error", "--fail", "--max-time", "15", `${httpsUrl}/api/status`,
  ], { label: "remote_https_health", timeoutMs: 30_000 });
  const body = JSON.parse(result.stdout);
  assert.equal(body.auth_required, true);
  state.categories.add("remote_command_https_reachability");
}

async function startLab(state, { diagnoseTunnel = false } = {}) {
  state.composeStarted = true;
  await compose(state, ["up", "-d", "--pull", "never", "--wait", "--wait-timeout", "180"], { label: "compose_up", timeoutMs: 240_000 });
  await Promise.all([waitHealthy(state, "model-stub"), waitHealthy(state, "hermes"), waitHealthy(state, "sshd")]);
  await seedSupportedSurfaces(state);
  const hermesPort = await servicePort(state, "hermes", 9119);
  const sshPort = await servicePort(state, "sshd", 2222);
  state.ports.push(hermesPort, sshPort);
  await pinSshHostKey(state, sshPort);
  const localUrl = `http://127.0.0.1:${hermesPort}`;
  await waitHttp(`${localUrl}/api/status`, { label: "hermes_health" });
  await assertComposeNetworkHealth(state);
  const httpsUrl = await quickTunnelUrl(state);
  if (diagnoseTunnel) console.log(JSON.stringify({ state: "ephemeral_tunnel_diagnostic", httpsUrl }));
  await waitDnsPublication(new URL(httpsUrl).hostname);
  state.categories.add("https_dns_published");
  await waitHttp(`${httpsUrl}/api/status`, { timeoutMs: 120_000, label: "https_edge_health" });
  await assertSshAuthAndInternalReachability(state, sshPort);
  const sshForwardUrl = await startSshForward(state, sshPort, hermesPort);
  await assertSshRemoteReachability(state, sshPort, httpsUrl);
  state.endpointDigests = Object.freeze({ local: digest(localUrl), ssh: digest(sshForwardUrl), https: digest(httpsUrl) });
  state.categories.add("trusted_https_edge");
  return Object.freeze({ localUrl, sshForwardUrl, httpsUrl, sshPort });
}

async function automatedQualification(state, endpoints) {
  await qualifyDashboard(endpoints.localUrl, state, { invalidPassword: true, topology: "local", mutateBoard: true });
  await qualifyAgentCompletion(endpoints.localUrl, state, "local");
  await qualifyAgentControls(endpoints.localUrl, state, "local");
  await qualifyDashboard(endpoints.sshForwardUrl, state, { invalidPassword: true, topology: "ssh" });
  await qualifyAgentCompletion(endpoints.sshForwardUrl, state, "ssh");
  await qualifyAgentControls(endpoints.sshForwardUrl, state, "ssh");
  await qualifyDashboard(endpoints.httpsUrl, state, { invalidPassword: true, topology: "https" });
  await qualifyAgentCompletion(endpoints.httpsUrl, state, "https");
  await qualifyAgentControls(endpoints.httpsUrl, state, "https");
}

async function ownedResourceCounts(state) {
  const safeCapture = (args, label) => capture("docker", args, { label, timeoutMs: 30_000 })
    .catch(() => Object.freeze({ stdout: "", stderr: "", exitCode: null, timedOut: false, launchFailed: true }));
  const [containers, networks, volumes] = await Promise.all([
    safeCapture(["ps", "-aq", "--filter", `label=com.docker.compose.project=${state.project}`], "cleanup_containers"),
    safeCapture(["network", "ls", "-q", "--filter", `label=com.docker.compose.project=${state.project}`], "cleanup_networks"),
    safeCapture(["volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${state.project}`], "cleanup_volumes"),
  ]);
  const proven = (result) => result.exitCode === 0 && result.timedOut === false && result.launchFailed !== true;
  const count = (result) => proven(result)
    ? (result.stdout.trim() ? result.stdout.trim().split(/\s+/).length : 0)
    : -1;
  return Object.freeze({
    containers: count(containers),
    networks: count(networks),
    volumes: count(volumes),
    proof: [containers, networks, volumes].every(proven),
  });
}

async function stopOwnedProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return true;
  let observedExit = false;
  const exited = new Promise((resolveExit) => {
    child.once("exit", () => { observedExit = true; resolveExit(true); });
  });
  child.kill("SIGTERM");
  await Promise.race([exited, delay(3_000)]).catch(() => {});
  if (!observedExit && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  await Promise.race([exited, delay(3_000)]).catch(() => {});
  return observedExit || child.exitCode !== null || child.signalCode !== null;
}

async function cleanup(state) {
  const sshProcessStopped = await stopOwnedProcess(state.sshTunnel);
  state.sshTunnel = null;
  let downProof = true;
  if (state.composeStarted) {
    const down = await composeCapture(state, ["down", "--volumes", "--remove-orphans", "--timeout", "10"], { label: "compose_down", timeoutMs: 60_000 })
      .catch(() => Object.freeze({ exitCode: null, timedOut: false, launchFailed: true }));
    downProof = down.exitCode === 0 && down.timedOut === false && down.launchFailed !== true;
  }
  const resources = await ownedResourceCounts(state);
  const listenersClosed = (await Promise.all(state.ports.map(portClosed))).every(Boolean);
  if (state.taskRoot) await rm(state.taskRoot, { recursive: true, force: true }).catch(() => {});
  let rootRemoved = state.taskRoot === null;
  if (state.taskRoot) {
    try { await stat(state.taskRoot); } catch (error) { rootRemoved = error?.code === "ENOENT"; }
  }
  await rm(activeFile, { force: true });
  return Object.freeze({
    containers: resources.containers,
    networks: resources.networks,
    volumes: resources.volumes,
    dockerProof: downProof && resources.proof,
    listenersClosed,
    rootRemoved,
    sshProcessStopped,
  });
}

async function writeReceipt(state, verdict, cleanupResult, failureCode = null) {
  await mkdir(receiptDirectory, { recursive: true, mode: 0o700 });
  const receipt = Object.freeze({
    schema: "hermes-agent-qualification-v1",
    task: state.taskId,
    versions: VERSION_RECORD,
    categories: Object.freeze([...state.categories].sort()),
    categoryDigest: digest([...state.categories].sort().join("\n")),
    endpointDigests: state.endpointDigests,
    nativeEvidence: state.nativeEvidence,
    verdict,
    failureCode,
    cleanup: cleanupResult,
  });
  const path = resolve(receiptDirectory, `${state.taskId}.json`);
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  return path;
}

export function validateNativeResult(state, payload) {
  assert.equal(payload?.schema, "hermes-agent-native-observation-v1");
  assert.equal(payload.task, state.taskId);
  assert.equal(payload.challengeDigest, digest(state.challenge));
  assert.equal(payload.muxyVersion, "1.5.0 (945)");
  assert.deepEqual([...new Set(payload.categories)].sort(), [...REQUIRED_NATIVE_CATEGORIES].sort());
  assert.equal(payload.claims?.privacyScan, true);
  assert.equal(payload.claims?.workspacePathAbsent, true);
  assert.equal(payload.claims?.remoteSecretAbsent, true);
  const screenshots = {};
  for (const [key, expectedPath] of Object.entries(REQUIRED_SCREENSHOTS)) {
    const screenshot = payload.screenshots?.[key];
    assert.equal(screenshot?.path, expectedPath);
    assert.match(screenshot?.sha256 ?? "", /^[a-f0-9]{64}$/);
    assert.equal(screenshot?.width, 1600);
    assert.equal(screenshot?.height, 1000);
    screenshots[key] = Object.freeze({ ...screenshot });
  }
  return Object.freeze({
    muxyVersion: payload.muxyVersion,
    categories: Object.freeze([...REQUIRED_NATIVE_CATEGORIES]),
    claims: Object.freeze({ ...payload.claims }),
    screenshots: Object.freeze(screenshots),
  });
}

async function holdForNative(state, endpoints) {
  await mkdir(resolve(root, ".qualification"), { recursive: true, mode: 0o700 });
  const challengeFile = join(state.taskRoot, "verifier/challenge");
  const nativeResultFile = join(state.taskRoot, "verifier/native-result.json");
  await writeFile(activeFile, `${JSON.stringify({
    schema: "hermes-agent-active-lab-v1",
    task: state.taskId,
    taskRoot: state.taskRoot,
    localUrl: endpoints.localUrl,
    sshForwardUrl: endpoints.sshForwardUrl,
    httpsUrl: endpoints.httpsUrl,
    sshPort: endpoints.sshPort,
    sshUser: "muxy",
    sshKeyPath: state.keyPath,
    secretFile: join(state.taskRoot, "secret.json"),
    challengeFile,
    nativeResultFile,
    requiredNativeCategories: REQUIRED_NATIVE_CATEGORIES,
    requiredScreenshots: REQUIRED_SCREENSHOTS,
  }, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ ok: true, state: "native_hold", task: state.taskId, activeFile: ".qualification/active.json" }));
  let interrupted = false;
  const markInterrupted = () => { interrupted = true; };
  process.once("SIGINT", markInterrupted);
  process.once("SIGTERM", markInterrupted);
  const deadline = Date.now() + 45 * 60_000;
  try {
    while (Date.now() < deadline) {
      if (interrupted) throw new Error("native_qualification_incomplete");
      try {
        const payload = JSON.parse(await readFile(nativeResultFile, "utf8"));
        state.nativeEvidence = validateNativeResult(state, payload);
        for (const category of state.nativeEvidence.categories) state.categories.add(category);
        state.categories.add("manual_native_observations_recorded");
        return;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      await delay(1_000);
    }
    throw new Error("native_qualification_timeout");
  } finally {
    process.off("SIGINT", markInterrupted);
    process.off("SIGTERM", markInterrupted);
  }
}

export async function qualifyRelease({ nativeHold = false, diagnoseTunnel = false, testHooks = null } = {}) {
  const hooks = Object.freeze({
    createState: createBootstrapState,
    initialize: initializeTaskState,
    start: startLab,
    automate: automatedQualification,
    hold: holdForNative,
    cleanup,
    writeReceipt,
    log: (value) => console.log(value),
    ...(testHooks ?? {}),
  });
  const state = hooks.createState();
  let verdict = "failed";
  let failureCode = null;
  let qualificationError = null;
  let cleanupResult = Object.freeze({ containers: -1, networks: -1, volumes: -1, dockerProof: false, listenersClosed: false, rootRemoved: false, sshProcessStopped: false });
  try {
    await hooks.initialize(state);
    const endpoints = await hooks.start(state, { diagnoseTunnel });
    await hooks.automate(state, endpoints);
    if (nativeHold) {
      await hooks.hold(state, endpoints);
      verdict = "manual_native_evidence_recorded_release_blocked";
      failureCode = "native_evidence_not_muxy_attested";
    } else {
      verdict = "passed_supported_beta_matrix";
    }
  } catch (error) {
    failureCode = typeof error?.message === "string" && /^[a-z0-9_:-]{1,120}$/i.test(error.message) ? error.message : "qualification_failed";
    qualificationError = error;
  } finally {
    cleanupResult = await hooks.cleanup(state).catch(() => Object.freeze({
      containers: -1,
      networks: -1,
      volumes: -1,
      dockerProof: false,
      listenersClosed: false,
      rootRemoved: false,
      sshProcessStopped: false,
    }));
    const cleanupPassed = cleanupResult.containers === 0
      && cleanupResult.networks === 0
      && cleanupResult.volumes === 0
      && cleanupResult.dockerProof
      && cleanupResult.listenersClosed
      && cleanupResult.rootRemoved
      && cleanupResult.sshProcessStopped;
    if (!cleanupPassed) verdict = "cleanup_failed";
    const receiptPath = await hooks.writeReceipt(state, verdict, cleanupResult, failureCode);
    hooks.log(JSON.stringify({ verdict, receipt: receiptPath.replace(`${root}/`, ""), cleanup: cleanupResult }, null, 2));
  }
  if (qualificationError) throw qualificationError;
  if (verdict === "cleanup_failed" || verdict === "failed") throw new Error(verdict);
  if (nativeHold) throw new Error("native_evidence_not_muxy_attested");
  return Object.freeze({ verdict, cleanup: cleanupResult });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const nativeHold = process.argv.includes("--native-hold");
  const diagnoseTunnel = process.argv.includes("--diagnose-tunnel");
  await qualifyRelease({ nativeHold, diagnoseTunnel });
}
