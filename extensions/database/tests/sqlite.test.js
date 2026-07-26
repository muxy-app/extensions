import assert from "node:assert/strict";
import test from "node:test";

let calls = [];

globalThis.muxy = {
    exec: async (argv) => {
        calls.push(argv);
        return { exitCode: 0, stdout: '[{"version":"3.51.0"}]', stderr: "" };
    },
};

const { sqlite } = await import("../src/lib/drivers/sqlite.js");
const ctx = { conn: { sqlite: { path: "/tmp/Application Support/example.sqlite" } } };

test("connection test refuses to create a missing SQLite database", async () => {
    calls = [];
    await sqlite.test(ctx);
    assert.deepEqual(calls[0], [
        "sqlite3",
        "-batch",
        "-bail",
        "-json",
        "file:/tmp/Application%20Support/example.sqlite?mode=rw",
        "SELECT sqlite_version() AS version",
    ]);
});

test("table discovery maps SQLite tables and views", async () => {
    calls = [];
    muxy.exec = async (argv) => {
        calls.push(argv);
        return { exitCode: 0, stdout: '[{"name":"accounts","type":"table"},{"name":"balances","type":"view"}]', stderr: "" };
    };
    assert.deepEqual(await sqlite.listTables(ctx), [
        { name: "accounts", kind: "table" },
        { name: "balances", kind: "view" },
    ]);
    assert.deepEqual(calls[0].slice(0, 5), ["sqlite3", "-batch", "-bail", "-json", "file:/tmp/Application%20Support/example.sqlite?mode=rw"]);
});
