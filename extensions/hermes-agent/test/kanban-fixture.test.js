import assert from "node:assert/strict";
import test from "node:test";

import {
  KANBAN_FIXTURE_BOARD,
  KANBAN_FIXTURE_PASSWORD,
  KANBAN_FIXTURE_USERNAME,
  startKanbanFixture,
} from "../scripts/run-kanban-fixture.mjs";

function request(fixture, path, { method = "GET", cookie = "", body, redirect = "follow" } = {}) {
  return fetch(`${fixture.url}${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect,
  });
}

function sessionCookie(response) {
  return response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
}

async function login(fixture, password = KANBAN_FIXTURE_PASSWORD) {
  const response = await request(fixture, "/auth/password-login", {
    method: "POST",
    body: { provider: "basic", username: KANBAN_FIXTURE_USERNAME, password },
  });
  return { response, cookie: sessionCookie(response) };
}

test("Kanban fixture is loopback-only, password-session authenticated, seeded, and mutable in memory", async () => {
  const fixture = await startKanbanFixture();
  const boardPath = `/api/plugins/kanban/board?board=${KANBAN_FIXTURE_BOARD}`;
  try {
    assert.match(fixture.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal((await request(fixture, "/api/status")).status, 200);
    assert.equal((await request(fixture, "/api/auth/providers")).status, 200);
    assert.equal((await request(fixture, boardPath)).status, 401);
    assert.equal((await login(fixture, "wrong")).response.status, 401);
    const { response: loginResponse, cookie } = await login(fixture);
    assert.equal(loginResponse.status, 200);
    assert.match(cookie, /hermes_session_at=/);
    assert.match(cookie, /hermes_session_rt=/);
    assert.equal((await request(fixture, "/api/auth/me", { cookie })).status, 200);

    const catalogResponse = await request(fixture, "/api/plugins/kanban/boards", { cookie });
    assert.equal(catalogResponse.status, 200);
    const catalog = await catalogResponse.json();
    assert.equal(catalog.current, KANBAN_FIXTURE_BOARD);
    assert.equal(catalog.boards[0].slug, KANBAN_FIXTURE_BOARD);
    assert.equal(catalog.boards[0].is_current, true);

    const initial = await request(fixture, boardPath, { cookie });
    assert.equal(initial.status, 200);
    const initialBoard = await initial.json();
    assert.deepEqual(initialBoard.columns.map((column) => column.name), ["triage", "todo", "scheduled", "ready", "running", "blocked", "review", "done"]);
    assert.equal(initialBoard.columns.reduce((sum, column) => sum + column.tasks.length, 0), 4);
    assert.equal(JSON.stringify(initialBoard).includes("workspace_path"), false);

    const created = await request(fixture, `/api/plugins/kanban/tasks?board=${KANBAN_FIXTURE_BOARD}`, {
      method: "POST",
      cookie,
      body: { title: "Created through fixture", triage: true, workspace_kind: "scratch", idempotency_key: "fixture-test" },
    });
    assert.equal(created.status, 200);
    const createdTask = (await created.json()).task;
    assert.equal(createdTask.status, "triage");

    const moved = await request(fixture, `/api/plugins/kanban/tasks/${createdTask.id}?board=${KANBAN_FIXTURE_BOARD}`, {
      method: "PATCH",
      cookie,
      body: { status: "ready" },
    });
    assert.equal(moved.status, 200);
    assert.equal((await moved.json()).task.status, "ready");

    const finalBoard = await (await request(fixture, boardPath, { cookie })).json();
    assert.equal(finalBoard.columns.find((column) => column.name === "ready").tasks.some((task) => task.id === createdTask.id), true);
    assert.deepEqual(fixture.observation(), { loginAttempts: 2, authenticatedRequests: 6, created: 1, moved: 1, loggedOut: 0 });
  } finally {
    await fixture.close();
  }
});

test("Kanban fixture rejects unknown boards, routes, statuses, and non-scratch creates", async () => {
  const fixture = await startKanbanFixture();
  try {
    const { cookie } = await login(fixture);
    assert.equal((await request(fixture, "/api/plugins/kanban/board?board=other", { cookie })).status, 404);
    assert.equal((await request(fixture, `/api/plugins/kanban/unknown?board=${KANBAN_FIXTURE_BOARD}`, { cookie })).status, 404);
    assert.equal((await request(fixture, `/api/plugins/kanban/tasks/t_fixture_todo?board=${KANBAN_FIXTURE_BOARD}`, { method: "PATCH", cookie, body: { status: "invented" } })).status, 400);
    assert.equal((await request(fixture, `/api/plugins/kanban/tasks?board=${KANBAN_FIXTURE_BOARD}`, { method: "POST", cookie, body: { title: "Unsafe", workspace_kind: "dir", workspace_path: "/tmp" } })).status, 400);
  } finally {
    await fixture.close();
  }
});

test("Kanban fixture exposes identity, expiry, and logout without bearer fallback", async () => {
  const fixture = await startKanbanFixture({ sessionTtlMs: 20 });
  try {
    const { cookie } = await login(fixture);
    const me = await request(fixture, "/api/auth/me", { cookie });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).provider, "basic");
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal((await request(fixture, "/api/auth/me", { cookie })).status, 401);

    const second = await login(fixture);
    const logout = await request(fixture, "/auth/logout", { method: "POST", cookie: second.cookie, redirect: "manual" });
    assert.equal(logout.status, 302);
    assert.equal((await request(fixture, "/api/auth/me", { cookie: second.cookie })).status, 401);
    assert.equal(fixture.observation().loggedOut, 1);
  } finally {
    await fixture.close();
  }
});
