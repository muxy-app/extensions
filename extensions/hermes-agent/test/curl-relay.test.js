import assert from "node:assert/strict";
import test from "node:test";

import { CurlRelay, buildSessionConfig } from "../src/curl-relay.js";

function response({ status = 200, body = { ok: true }, headers = [], exitCode = 0 } = {}) {
  return {
    stdout: [
      `HTTP/1.1 ${status} Fixture`,
      ...headers,
      "",
      body === null ? "" : JSON.stringify(body),
      `__MUXY_HERMES_STATUS__:${status}`,
    ].join("\r\n"),
    stderr: "",
    exitCode,
    timedOut: false,
    truncated: false,
  };
}

test("session config keeps cookies and credential bodies in stdin and rejects injection", () => {
  const config = buildSessionConfig({
    cookie: "hermes_session_at=access.jwt; hermes_session_rt=refresh-token",
    body: { provider: "basic", username: "admin", password: "line\nquote\"slash\\" },
  });
  assert.match(config, /Cookie: hermes_session_at=access\.jwt; hermes_session_rt=refresh-token/);
  assert.match(config, /data-binary = /);
  assert.doesNotMatch(config, /\nheader = "X-Evil/);
  for (const cookie of ["bad\nheader=x", "bad\rcookie=x", 'bad"=x', "missing-value", "a=x;injected=y"]) {
    assert.throws(() => buildSessionConfig({ cookie }), /session cookie/i);
  }
});

test("Dashboard request uses argv-form curl with all secrets in stdin", async () => {
  const calls = [];
  const relay = new CurlRelay({
    exec: async (argv, options) => {
      calls.push({ argv, options });
      return response({
        headers: [
          "Set-Cookie: hermes_session_at=access.jwt; HttpOnly; SameSite=Lax",
          "Set-Cookie: hermes_session_rt=refresh-token; HttpOnly; SameSite=Lax",
          "Set-Cookie: unrelated=ignored; HttpOnly",
        ],
      });
    },
  });

  const result = await relay.requestSessionJson({
    url: "https://hermes.example/auth/password-login",
    method: "POST",
    body: { provider: "basic", username: "admin", password: "sentinel-password" },
  });

  assert.deepEqual(result.body, { ok: true });
  assert.deepEqual(result.setCookies, [
    { name: "hermes_session_at", value: "access.jwt", expired: false },
    { name: "hermes_session_rt", value: "refresh-token", expired: false },
  ]);
  assert.equal(calls[0].argv[0], "/usr/bin/curl");
  assert.equal(JSON.stringify(calls[0].argv).includes("sentinel-password"), false);
  assert.equal(calls[0].options.stdin.includes("sentinel-password"), true);
  assert.equal(Object.hasOwn(calls[0].options, "env"), false);
  assert.equal(calls[0].argv.includes("--create-dirs"), false);
  assert.equal(calls[0].argv.includes("--no-buffer"), false);
  assert.equal(calls[0].argv.includes("Accept: application/json"), false);
  assert.equal(calls[0].argv.every((argument) => !/\s/.test(argument)), true);
});

test("Dashboard request preserves only the complete Hermes session cookie family", async () => {
  const relay = new CurlRelay({
    exec: async () => response({ headers: [
      "Set-Cookie: __Host-hermes_session_at=\"access-token==\"; HttpOnly; Secure",
      "Set-Cookie: __Host-hermes_session_rt=\"refresh-token==\"; HttpOnly; Secure",
      "Set-Cookie: __Host-hermes_session_provider=basic; HttpOnly; Secure",
      "Set-Cookie: analytics=forbidden; Secure",
    ] }),
  });
  const result = await relay.requestSessionJson({ url: "https://hermes.example/api/auth/me" });
  assert.deepEqual(result.setCookies, [
    { name: "__Host-hermes_session_at", value: "access-token==", expired: false },
    { name: "__Host-hermes_session_rt", value: "refresh-token==", expired: false },
    { name: "__Host-hermes_session_provider", value: "basic", expired: false },
  ]);
});

test("Dashboard request accepts quoted or unquoted cookie deletion and rejects malformed cookie values", async () => {
  const deletion = new CurlRelay({ exec: async () => response({ headers: [
    "Set-Cookie: hermes_session_at=; Max-Age=0",
    "Set-Cookie: hermes_session_rt=\"\"; Max-Age=0",
  ] }) });
  assert.deepEqual((await deletion.requestSessionJson({ url: "http://127.0.0.1:9119/auth/logout" })).setCookies, [
    { name: "hermes_session_at", value: "", expired: true },
    { name: "hermes_session_rt", value: "", expired: true },
  ]);

  const malformed = new CurlRelay({ exec: async () => response({ headers: ["Set-Cookie: hermes_session_at=\"access\\token\"; HttpOnly"] }) });
  await assert.rejects(malformed.requestSessionJson({ url: "http://127.0.0.1:9119/api/auth/me" }), /relay_protocol_error/);
});

test("Dashboard request returns bounded sanitized relay failures", async () => {
  for (const [result, code] of [
    [{ timedOut: true, exitCode: 28, stdout: "" }, "relay_timeout"],
    [{ truncated: true, exitCode: 0, stdout: "" }, "relay_response_too_large"],
    [{ timedOut: false, truncated: false, exitCode: 7, stdout: "", stderr: "secret host details" }, "relay_request_failed"],
    [{ timedOut: false, truncated: false, exitCode: 0, stdout: "not-http" }, "relay_protocol_error"],
  ]) {
    const relay = new CurlRelay({ exec: async () => result });
    await assert.rejects(relay.requestSessionJson({ url: "https://hermes.example/api/status" }), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.message.includes("secret host details"), false);
      return true;
    });
  }
});

test("Dashboard request classifies rejected and incomplete Muxy command results", async () => {
  const rejected = new CurlRelay({ exec: async () => { throw new Error("contains remote URL and credentials"); } });
  await assert.rejects(
    rejected.requestSessionJson({ url: "https://hermes.example/api/status" }),
    (error) => error.code === "relay_execution_rejected" && !error.message.includes("credentials"),
  );

  const missingResult = new CurlRelay({ exec: async () => null });
  await assert.rejects(missingResult.requestSessionJson({ url: "https://hermes.example/api/status" }), { code: "relay_result_unavailable" });

  const missingOutput = new CurlRelay({ exec: async () => ({ exitCode: 0 }) });
  await assert.rejects(missingOutput.requestSessionJson({ url: "https://hermes.example/api/status" }), { code: "relay_output_unavailable" });

  for (const [message, code] of [
    ["exec failed to launch: private remote detail", "relay_launch_failed"],
    ["exec failed to launch: configure standard stream: bad file descriptor", "relay_launch_stream_failed"],
    ["exec failed to launch: spawn process: unknown host failure", "relay_launch_spawn_failed"],
    ["exec failed to launch: spawn process: operation not permitted", "relay_launch_spawn_not_permitted"],
    ["exec failed to launch: spawn process: no such file or directory", "relay_launch_spawn_missing"],
    ["exec failed to launch: spawn process: resource temporarily unavailable", "relay_launch_spawn_busy"],
    ["exec failed to launch: spawn process: argument list too long", "relay_launch_spawn_too_large"],
    ["exec failed to launch: arguments and environment cannot contain null bytes", "relay_launch_arguments_invalid"],
    ["exec: too many concurrent commands (limit 32)", "relay_concurrency_limit"],
    ["exec: permission denied (commands:exec)", "relay_permission_denied"],
    ["exec cancelled", "relay_cancelled"],
  ]) {
    const classified = new CurlRelay({ exec: async () => { throw new Error(message); } });
    await assert.rejects(classified.requestSessionJson({ url: "https://hermes.example/api/status" }), (error) => error.code === code && !error.message.includes("private"));
  }
});

test("Dashboard request rejects oversized bodies before command execution", async () => {
  let called = false;
  const relay = new CurlRelay({ exec: async () => { called = true; return response(); } });
  await assert.rejects(relay.requestSessionJson({ url: "https://hermes.example/api/test", method: "POST", body: { value: "x".repeat(70_000) } }), /relay_request_too_large/);
  assert.equal(called, false);
});
