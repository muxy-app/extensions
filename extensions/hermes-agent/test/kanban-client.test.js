import assert from "node:assert/strict";
import test from "node:test";

import {
  KANBAN_STATUSES,
  KanbanClient,
  KanbanClientError,
  normalizeBoard,
  normalizeBoardCatalog,
  normalizeBoardSlug,
  normalizeHermesDashboardUrl,
  selectBoardSlug,
} from "../src/kanban-client.js";

test("dashboard URLs support secure remote and loopback tunnel shapes without paths", () => {
  assert.equal(normalizeHermesDashboardUrl("https://hermes.example/"), "https://hermes.example");
  assert.equal(normalizeHermesDashboardUrl("http://127.0.0.1:8639"), "http://127.0.0.1:8639");
  assert.throws(() => normalizeHermesDashboardUrl("http://hermes.example"), /HTTPS/);
  assert.throws(() => normalizeHermesDashboardUrl("https://hermes.example/dashboard"), /base URL/);
  assert.throws(() => normalizeHermesDashboardUrl("https://token@hermes.example"), /without credentials/);
});

test("board slugs match Hermes multi-board naming constraints", () => {
  assert.equal(normalizeBoardSlug(" Project_One "), "project_one");
  for (const invalid of ["", "two words", "../escape", "-starts-wrong", "a".repeat(65)]) {
    assert.throws(() => normalizeBoardSlug(invalid), /Board slug/);
  }
});

test("board normalization keeps UI fields and drops paths, bodies, tokens, and unknown columns", () => {
  const normalized = normalizeBoard({
    columns: [
      {
        name: "todo",
        tasks: [{
          id: "t_123",
          title: "Ship it",
          status: "todo",
          assignee: "builder",
          tenant: "acme",
          priority: 2,
          comment_count: 3,
          progress: { done: 1, total: 2 },
          latest_summary: "Safe preview",
          workspace_path: "/secret/remote/path",
          body: "private body",
          bearer: "sentinel-token",
        }],
      },
      { name: "made_up", tasks: [{ id: "evil", title: "ignored" }] },
    ],
    assignees: ["builder"],
    tenants: ["acme"],
    secret: "sentinel-token",
  });

  assert.deepEqual(normalized.columns[0].tasks[0], {
    id: "t_123",
    title: "Ship it",
    status: "todo",
    assignee: "builder",
    tenant: "acme",
    priority: 2,
    commentCount: 3,
    summary: "Safe preview",
    progress: { done: 1, total: 2 },
  });
  assert.equal(JSON.stringify(normalized).includes("/secret/remote/path"), false);
  assert.equal(JSON.stringify(normalized).includes("sentinel-token"), false);
  assert.equal(normalized.columns.length, 1);
});

test("board catalog keeps only safe picker fields and selects deterministically", () => {
  const catalog = normalizeBoardCatalog({
    current: "beta",
    boards: [
      { slug: "alpha", name: "Alpha", description: "First board", total: 3, db_path: "/private/a", project_id: "secret-a" },
      { slug: "beta", name: "Beta", description: "Current board", total: 1, is_current: true, default_workdir: "/private/b" },
      { slug: "beta", name: "Duplicate", total: 99 },
      { slug: "../unsafe", name: "Unsafe", total: 7 },
      { slug: "missing-name", total: 2 },
    ],
  });
  assert.deepEqual(catalog, {
    current: "beta",
    boards: [
      { slug: "alpha", name: "Alpha", description: "First board", total: 3, isCurrent: false },
      { slug: "beta", name: "Beta", description: "Current board", total: 1, isCurrent: true },
    ],
  });
  assert.equal(JSON.stringify(catalog).includes("/private"), false);
  assert.equal(JSON.stringify(catalog).includes("secret-a"), false);
  assert.equal(selectBoardSlug(catalog, "alpha"), "alpha");
  assert.equal(selectBoardSlug(catalog, "not-in-catalog"), "beta");
  assert.equal(selectBoardSlug({ boards: catalog.boards, current: null }), "alpha");
  assert.equal(selectBoardSlug({ boards: [], current: "invented" }), null);
});

test("catalog uses an authenticated unscoped endpoint before a board is selected", async () => {
  const calls = [];
  const client = new KanbanClient({
    baseUrl: "https://hermes.example",
    session: {
      async requestJson(request) {
        calls.push(request);
        return request.url.endsWith("/boards")
          ? { status: 200, body: { boards: [{ slug: "alpha", name: "Alpha", total: 0 }], current: "alpha" } }
          : { status: 200, body: { columns: KANBAN_STATUSES.map((name) => ({ name, tasks: [] })) } };
      },
    },
  });
  const catalog = await client.listBoards();
  assert.equal(calls[0].url, "https://hermes.example/api/plugins/kanban/boards");
  assert.equal(calls[0].url.includes("?board="), false);
  assert.equal(catalog.current, "alpha");
  await assert.rejects(client.loadBoard(), /Choose a board first/);
  client.setBoard("alpha");
  await client.loadBoard();
  assert.equal(calls[1].url, "https://hermes.example/api/plugins/kanban/board?board=alpha");
});

test("Kanban client uses the verified dashboard session and keeps cookies out of URLs and bodies", async () => {
  const calls = [];
  const session = {
    async requestJson(request) {
      calls.push(request);
      if (request.method === "POST") return { status: 200, body: { task: { id: "t_new", title: "New", status: "triage" } } };
      if (request.method === "PATCH") return { status: 200, body: { task: { id: "t_new", title: "New", status: "ready" } } };
      return { status: 200, body: { columns: KANBAN_STATUSES.map((name) => ({ name, tasks: [] })), assignees: [], tenants: [] } };
    },
  };
  const client = new KanbanClient({ baseUrl: "https://hermes.example", session, board: "muxy-project" });

  await client.loadBoard();
  await client.createTask({ title: "New", body: "Implement the verified change.", assignee: "builder", triage: true, idempotencyKey: "muxy-123" });
  await client.updateStatus("t_new", "ready");

  assert.equal(calls[0].url, "https://hermes.example/api/plugins/kanban/board?board=muxy-project");
  assert.equal(calls[1].url, "https://hermes.example/api/plugins/kanban/tasks?board=muxy-project");
  assert.equal(calls[2].url, "https://hermes.example/api/plugins/kanban/tasks/t_new?board=muxy-project");
  assert.deepEqual(calls[1].body, {
    title: "New",
    body: "Implement the verified change.",
    assignee: "builder",
    triage: true,
    workspace_kind: "scratch",
    idempotency_key: "muxy-123",
  });
  assert.deepEqual(calls[2].body, { status: "ready" });
  assert.equal(JSON.stringify(calls).includes("cookie"), false);
  client.release();
  assert.equal(client.session, null);
});

test("Kanban task creation validates bounded instructions and assignee values", async () => {
  const client = new KanbanClient({
    baseUrl: "https://hermes.example",
    board: "default",
    session: { async requestJson() { throw new Error("request should not run"); } },
  });
  await assert.rejects(client.createTask({ title: "Task", body: "x".repeat(20_001) }), /instructions/);
  await assert.rejects(client.createTask({ title: "Task", assignee: "bad\nprofile" }), /assignee/);
});

test("Kanban client distinguishes authentication, unavailable plugin, and generic failures", async () => {
  for (const [status, code] of [[401, "dashboard_authentication_failed"], [404, "kanban_not_available"], [500, "kanban_request_failed"]]) {
    const client = new KanbanClient({
      baseUrl: "https://hermes.example",
      board: "default",
      session: { async requestJson() { return { status, body: null }; } },
    });
    await assert.rejects(client.loadBoard(), (error) => error instanceof KanbanClientError && error.code === code && error.status === status);
  }
});

test("catalog retains board request failure classifications", async () => {
  for (const [status, code] of [[401, "dashboard_authentication_failed"], [404, "kanban_not_available"], [500, "kanban_request_failed"]]) {
    const client = new KanbanClient({
      baseUrl: "https://hermes.example",
      session: { async requestJson() { return { status, body: null }; } },
    });
    await assert.rejects(client.listBoards(), (error) => error instanceof KanbanClientError && error.code === code && error.status === status);
  }
  const malformed = new KanbanClient({ baseUrl: "https://hermes.example", session: { async requestJson() { return { status: 200, body: {} }; } } });
  await assert.rejects(malformed.listBoards(), /kanban_contract_mismatch/);
});
