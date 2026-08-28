import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

export const KANBAN_FIXTURE_BOARD = "muxy-test";
export const KANBAN_FIXTURE_USERNAME = "muxy-test-user";
export const KANBAN_FIXTURE_PASSWORD = "kanban-fixture-password-only";
const API_ROOT = "/api/plugins/kanban";
const VALID_STATUSES = new Set(["triage", "todo", "scheduled", "ready", "running", "blocked", "review", "done"]);
const MAX_REQUEST_BYTES = 32 * 1024;
const SEED_URL = new URL("../fixtures/kanban/board.json", import.meta.url);

function closeServer(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function sendJson(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
    Connection: "close",
  });
  response.end(text);
}

function sendSessionJson(response, status, body, cookies = []) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
    Connection: "close",
    ...(cookies.length ? { "Set-Cookie": cookies } : {}),
  });
  response.end(text);
}

function safeClone(value) {
  return structuredClone(value);
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) throw new Error("fixture_request_too_large");
  }
  try { return JSON.parse(body || "{}"); }
  catch { throw new Error("fixture_request_invalid_json"); }
}

function findTask(board, id) {
  for (const column of board.columns) {
    const index = column.tasks.findIndex((task) => task.id === id);
    if (index >= 0) return { column, index, task: column.tasks[index] };
  }
  return null;
}

function validBoardRequest(url) {
  return url.searchParams.get("board") === KANBAN_FIXTURE_BOARD;
}

function parseCookies(request) {
  return new Map(String(request.headers.cookie ?? "").split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const split = part.indexOf("=");
    return split > 0 ? [part.slice(0, split), part.slice(split + 1)] : ["", ""];
  }).filter(([name]) => name));
}

function sessionCookies(access, refresh, maxAge) {
  return [
    `hermes_session_at=${access}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`,
    `hermes_session_rt=${refresh}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`,
  ];
}

function clearedSessionCookies() {
  return [
    "hermes_session_at=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
    "hermes_session_rt=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
  ];
}

/** Test-only Hermes dashboard analogue. State is bounded, in-memory, and never persisted. */
export async function startKanbanFixture({ sessionTtlMs = 60_000 } = {}) {
  if (!Number.isSafeInteger(sessionTtlMs) || sessionTtlMs < 1 || sessionTtlMs > 60 * 60 * 1000) throw new Error("kanban_fixture_invalid_session_ttl");
  const seed = JSON.parse(await readFile(SEED_URL, "utf8"));
  const board = safeClone(seed);
  const catalog = [{
    slug: KANBAN_FIXTURE_BOARD,
    name: "Muxy test board",
    description: "A deterministic board for the extension fixture",
    is_current: true,
    total: board.columns.reduce((count, column) => count + column.tasks.length, 0),
    db_path: "/fixture/private/kanban.sqlite",
    default_workdir: "/fixture/private/workspace",
    project_id: "fixture-internal-project",
  }];
  let sequence = 0;
  const sessions = new Map();
  const observations = { loginAttempts: 0, authenticatedRequests: 0, created: 0, moved: 0, loggedOut: 0 };

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/api/status") {
        sendJson(response, 200, { auth_required: true, auth_providers: ["basic"], auth_flows: ["cookie"] });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/auth/providers") {
        sendJson(response, 200, { providers: [{ name: "basic", display_name: "Username and password", supports_password: true }] });
        return;
      }
      if (request.method === "POST" && url.pathname === "/auth/password-login") {
        observations.loginAttempts += 1;
        const payload = await readJsonBody(request);
        if (payload.provider !== "basic" || payload.username !== KANBAN_FIXTURE_USERNAME || payload.password !== KANBAN_FIXTURE_PASSWORD) {
          sendJson(response, 401, { detail: "Invalid credentials" });
          return;
        }
        const access = randomUUID();
        const refresh = randomUUID();
        const expiresAt = Date.now() + sessionTtlMs;
        sessions.set(access, { refresh, expiresAt });
        sendSessionJson(response, 200, { ok: true, next: "/" }, sessionCookies(access, refresh, Math.max(1, Math.ceil(sessionTtlMs / 1000))));
        return;
      }

      const cookies = parseCookies(request);
      const access = cookies.get("hermes_session_at") ?? "";
      const session = sessions.get(access);
      if (!session || session.refresh !== cookies.get("hermes_session_rt") || session.expiresAt <= Date.now()) {
        if (session) sessions.delete(access);
        sendJson(response, 401, { error: "session_expired", detail: "Unauthorized" });
        return;
      }
      observations.authenticatedRequests += 1;
      if (request.method === "GET" && url.pathname === "/api/auth/me") {
        sendJson(response, 200, {
          user_id: "muxy-fixture-user",
          email: "muxy@example.invalid",
          display_name: "Muxy Fixture User",
          org_id: "muxy-fixture-org",
          provider: "basic",
          expires_at: Math.ceil(session.expiresAt / 1000),
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/auth/logout") {
        sessions.delete(access);
        observations.loggedOut += 1;
        response.writeHead(302, { Location: "/login", "Cache-Control": "no-store", "Set-Cookie": clearedSessionCookies(), Connection: "close" });
        response.end();
        return;
      }
      if (request.method === "GET" && url.pathname === `${API_ROOT}/boards`) {
        sendJson(response, 200, { boards: safeClone(catalog), current: KANBAN_FIXTURE_BOARD });
        return;
      }
      if (!validBoardRequest(url)) {
        sendJson(response, 404, { detail: "board not found" });
        return;
      }

      if (request.method === "GET" && url.pathname === `${API_ROOT}/board`) {
        sendJson(response, 200, safeClone({
          columns: board.columns,
          assignees: board.assignees,
          tenants: board.tenants,
          latest_event_id: observations.created + observations.moved,
          now: Math.floor(Date.now() / 1_000),
        }));
        return;
      }

      if (request.method === "POST" && url.pathname === `${API_ROOT}/tasks`) {
        const payload = await readJsonBody(request);
        const title = typeof payload.title === "string" ? payload.title.trim() : "";
        if (!title || title.length > 1_000 || payload.workspace_kind !== "scratch") {
          sendJson(response, 400, { detail: "invalid task" });
          return;
        }
        sequence += 1;
        const status = payload.triage === true ? "triage" : "todo";
        const task = {
          id: `t_fixture_created_${String(sequence).padStart(3, "0")}`,
          title,
          status,
          assignee: null,
          tenant: KANBAN_FIXTURE_BOARD,
          priority: 0,
          comment_count: 0,
          latest_summary: null,
        };
        board.columns.find((column) => column.name === status).tasks.push(task);
        observations.created += 1;
        sendJson(response, 200, { task: safeClone(task) });
        return;
      }

      const match = url.pathname.match(new RegExp(`^${API_ROOT}/tasks/([A-Za-z0-9_-]{1,128})$`));
      if (request.method === "PATCH" && match) {
        const payload = await readJsonBody(request);
        if (!VALID_STATUSES.has(payload.status)) {
          sendJson(response, 400, { detail: "invalid status" });
          return;
        }
        const found = findTask(board, match[1]);
        if (!found) {
          sendJson(response, 404, { detail: "task not found" });
          return;
        }
        found.column.tasks.splice(found.index, 1);
        found.task.status = payload.status;
        board.columns.find((column) => column.name === payload.status).tasks.push(found.task);
        observations.moved += 1;
        sendJson(response, 200, { task: safeClone(found.task) });
        return;
      }

      sendJson(response, 404, { detail: "route not found" });
    } catch (error) {
      sendJson(response, error?.message === "fixture_request_too_large" ? 413 : 400, { detail: "invalid fixture request" });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string" || address.address !== "127.0.0.1") {
    await closeServer(server);
    throw new Error("kanban_fixture_not_loopback");
  }
  return Object.freeze({
    url: `http://127.0.0.1:${address.port}`,
    board: KANBAN_FIXTURE_BOARD,
    observation: () => Object.freeze({ ...observations }),
    close: () => closeServer(server),
  });
}

async function runCli() {
  const fixture = await startKanbanFixture();
  process.stdout.write(`${JSON.stringify({
    status: "kanban_fixture_ready",
    dashboardUrl: fixture.url,
    board: fixture.board,
    auth: "username_password",
    contract: "board_session_create_move_v2",
  })}\n`);
  await new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await fixture.close();
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runCli().catch((error) => {
    process.stderr.write(`${error?.message ?? "kanban_fixture_failed"}\n`);
    process.exitCode = 1;
  });
}
