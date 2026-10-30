// Integration test for the CCTray transport: a real HTTP server, a real curl
// invocation, and the real header/body split the provider depends on.
//
// `window.muxy.exec` is stubbed with child_process so the provider runs exactly
// as it does in the panel.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";

import { fetchProjects, loadRuns } from "../src/providers/cctray.js";
import { STATUS } from "../src/model.js";

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<Projects>
  <Project name="Platform :: Build" activity="Sleeping" lastBuildStatus="Success"
           lastBuildLabel="1841" lastBuildTime="2026-08-26T10:30:34Z"
           webUrl="https://ci.example.com/build/1841"/>
  <Project name="Platform :: E2E" activity="Building" lastBuildStatus="Failure"
           lastBuildLabel="1842" lastBuildTime="2026-08-26T11:02:00Z"
           webUrl="https://ci.example.com/build/1842"/>
</Projects>`;

// Mirrors src/exec.js's contract on top of a real subprocess.
globalThis.window = {
  muxy: {
    exec: (argv) =>
      new Promise((resolve) => {
        execFile(argv[0], argv.slice(1), { maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
          resolve({ stdout, stderr, exitCode: err?.code ?? 0 });
        });
      }),
  },
};

/** A server that optionally demands a bearer token. */
function startServer({ token = "" } = {}) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (token && req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401, { "Content-Type": "text/plain" });
        return res.end("nope");
      }
      if (req.url === "/not-cctray") {
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end("<html><body>hello</body></html>");
      }
      if (req.url === "/boom") {
        res.writeHead(500, { "Content-Type": "text/plain" });
        return res.end("kaboom");
      }
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end(FEED);
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const urlFor = (server, path = "/cc.xml") => `http://127.0.0.1:${server.address().port}${path}`;
const source = (over = {}) => ({ id: "s1", kind: "cctray", label: "CI", auth: { kind: "none" }, projects: [], ...over });

test("fetches and parses a live CCTray feed", async () => {
  const server = await startServer();
  try {
    const projects = await fetchProjects(source({ url: urlFor(server) }));
    assert.equal(projects.length, 2);
    assert.equal(projects[0].name, "Platform :: Build");
  } finally {
    server.close();
  }
});

test("loadRuns maps a live feed onto normalized runs", async () => {
  const server = await startServer();
  try {
    const runs = await loadRuns(source({ url: urlFor(server) }));
    assert.deepEqual(runs.map((r) => r.status), [STATUS.success, STATUS.running]);
    assert.equal(runs[0].number, "1841");
    assert.equal(runs[0].webUrl, "https://ci.example.com/build/1841");
  } finally {
    server.close();
  }
});

test("the project allowlist narrows a shared feed to one project", async () => {
  const server = await startServer();
  try {
    const runs = await loadRuns(source({ url: urlFor(server), projects: ["Platform :: E2E"] }));
    assert.equal(runs.length, 1);
    assert.equal(runs[0].title, "E2E");
  } finally {
    server.close();
  }
});

test("a bearer token is actually sent on the wire", async () => {
  const server = await startServer({ token: "s3cret" });
  try {
    const projects = await fetchProjects(source({ url: urlFor(server), auth: { kind: "token", token: "s3cret" } }));
    assert.equal(projects.length, 2);
  } finally {
    server.close();
  }
});

test("a 401 is reported as an auth problem, not a parse failure", async () => {
  const server = await startServer({ token: "s3cret" });
  try {
    await assert.rejects(
      () => fetchProjects(source({ url: urlFor(server) })),
      (e) => e.kind === "auth" && /401/.test(e.message),
    );
  } finally {
    server.close();
  }
});

test("a 500 surfaces the status rather than an XML error", async () => {
  const server = await startServer();
  try {
    await assert.rejects(
      () => fetchProjects(source({ url: urlFor(server, "/boom") })),
      (e) => e.kind === "failed" && /HTTP 500/.test(e.message),
    );
  } finally {
    server.close();
  }
});

test("a 200 that is not CCTray is called out as such", async () => {
  const server = await startServer();
  try {
    await assert.rejects(
      () => fetchProjects(source({ url: urlFor(server, "/not-cctray") })),
      (e) => /did not return a CCTray project list/.test(e.message),
    );
  } finally {
    server.close();
  }
});

test("an unreachable host produces a readable message", async () => {
  // Port 1 on loopback refuses immediately, so this stays fast and offline.
  await assert.rejects(
    () => fetchProjects(source({ url: "http://127.0.0.1:1/cc.xml" })),
    (e) => e.kind === "failed" && e.message.length > 0,
  );
});
