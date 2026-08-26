import assert from "node:assert/strict";
import test from "node:test";

import { DashboardAuthError, DashboardAuthSession } from "../src/dashboard-auth.js";

function response(status, body, setCookies = []) {
  return { status, body, setCookies };
}

test("dashboard auth discovers password providers before accepting credentials", async () => {
  const calls = [];
  const relay = {
    async requestSessionJson(request) {
      calls.push(request);
      if (request.url.endsWith("/api/status")) return response(200, { auth_required: true, auth_providers: ["basic"], auth_flows: ["cookie"] });
      return response(200, { providers: [{ name: "basic", display_name: "Password", supports_password: true }, { name: "nous", display_name: "Nous Research", supports_password: false }] });
    },
  };
  const auth = new DashboardAuthSession({ baseUrl: "https://hermes.example", relay });
  const discovered = await auth.discover();
  assert.equal(discovered.state, "logged_out");
  assert.deepEqual(discovered.providers, [
    { name: "basic", displayName: "Password", supportsPassword: true },
    { name: "nous", displayName: "Nous Research", supportsPassword: false },
  ]);
  await assert.rejects(auth.login({ provider: "nous", username: "a", password: "b" }), (error) => error instanceof DashboardAuthError && error.code === "password_login_not_supported");
  assert.equal(calls.length, 2);
});

test("dashboard auth logs in, verifies identity, rotates cookies, and logs out", async () => {
  const calls = [];
  const relay = {
    async requestSessionJson(request) {
      calls.push(request);
      if (request.url.endsWith("/api/status")) return response(200, { auth_required: true, auth_providers: ["basic"], auth_flows: ["cookie"] });
      if (request.url.endsWith("/api/auth/providers")) return response(200, { providers: [{ name: "basic", display_name: "Password", supports_password: true }] });
      if (request.url.endsWith("/auth/password-login")) return response(200, { ok: true }, [
        { name: "hermes_session_at", value: "access-one", expired: false },
        { name: "hermes_session_rt", value: "refresh-one", expired: false },
      ]);
      if (request.url.endsWith("/api/auth/me")) return response(200, {
        user_id: "user-123", email: "user@example.com", display_name: "Muxy User", org_id: "org-1", provider: "basic", expires_at: Math.floor(Date.now() / 1000) + 3600,
      }, [{ name: "hermes_session_at", value: "access-two", expired: false }]);
      if (request.url.endsWith("/auth/logout")) return response(302, null, [
        { name: "hermes_session_at", value: "", expired: true },
        { name: "hermes_session_rt", value: "", expired: true },
      ]);
      throw new Error("unexpected request");
    },
  };
  const auth = new DashboardAuthSession({ baseUrl: "https://hermes.example", relay });
  await auth.discover();
  const snapshot = await auth.login({ provider: "basic", username: "admin", password: "sentinel-password" });
  assert.equal(snapshot.state, "logged_in");
  assert.equal(snapshot.identity.displayName, "Muxy User");
  assert.equal(snapshot.identity.provider, "basic");
  assert.equal(calls.find((call) => call.url.endsWith("/api/auth/me")).cookie.includes("access-two"), false);
  assert.equal(auth.cookieHeaderForTest().includes("access-two"), true);
  assert.equal(JSON.stringify(snapshot).includes("access-two"), false);
  assert.equal(JSON.stringify(snapshot).includes("sentinel-password"), false);
  await auth.logout();
  assert.equal(auth.snapshot.state, "logged_out");
  assert.equal(auth.cookieHeaderForTest(), "");
});

test("dashboard auth forwards Hermes's provider routing cookie when it verifies a session", async () => {
  let verifyCookie = "";
  const relay = {
    async requestSessionJson(request) {
      if (request.url.endsWith("/api/status")) return response(200, { auth_required: true });
      if (request.url.endsWith("/api/auth/providers")) return response(200, { providers: [{ name: "basic", display_name: "Password", supports_password: true }] });
      if (request.url.endsWith("/auth/password-login")) return response(200, { ok: true }, [
        { name: "__Host-hermes_session_at", value: "access-one", expired: false },
        { name: "__Host-hermes_session_rt", value: "refresh-one", expired: false },
        { name: "__Host-hermes_session_provider", value: "basic", expired: false },
      ]);
      if (request.url.endsWith("/api/auth/me")) {
        verifyCookie = request.cookie;
        return response(200, {
          user_id: "user-123", email: "", display_name: "Muxy User", org_id: "", provider: "basic", expires_at: Math.floor(Date.now() / 1000) + 3600,
        });
      }
      throw new Error("unexpected request");
    },
  };
  const auth = new DashboardAuthSession({ baseUrl: "https://hermes.example", relay });

  await auth.discover();
  await auth.login({ provider: "basic", username: "admin", password: "sentinel-password" });

  assert.match(verifyCookie, /__Host-hermes_session_at=access-one/);
  assert.match(verifyCookie, /__Host-hermes_session_provider=basic/);
});

test("dashboard auth can restore an in-memory cookie session without ever retaining the password", async () => {
  const relay = {
    async requestSessionJson(request) {
      if (request.url.endsWith("/api/status")) return response(200, { auth_required: true });
      if (request.url.endsWith("/api/auth/providers")) return response(200, { providers: [{ name: "basic", display_name: "Password", supports_password: true }] });
      if (request.url.endsWith("/auth/password-login")) return response(200, { ok: true }, [{ name: "hermes_session_at", value: "access-one", expired: false }]);
      if (request.url.endsWith("/api/auth/me")) return response(200, {
        user_id: "user-123", email: "user@example.com", display_name: "Muxy User", org_id: "org-1", provider: "basic", expires_at: Math.floor(Date.now() / 1000) + 3600,
      });
      throw new Error("unexpected request");
    },
  };
  const auth = new DashboardAuthSession({ baseUrl: "https://hermes.example", relay });
  await auth.discover();
  await auth.login({ provider: "basic", username: "admin", password: "sentinel-password" });
  const stored = auth.exportSession();
  const restored = DashboardAuthSession.fromSession({ baseUrl: "https://hermes.example", relay, session: stored });

  assert.equal(restored.snapshot.state, "logged_in");
  assert.equal(restored.cookieHeaderForTest().includes("access-one"), true);
  assert.equal(JSON.stringify(stored).includes("sentinel-password"), false);
  await restored.verify();
});

test("dashboard auth clears session on invalid credentials, expiry, and unauthorized responses", async () => {
  let mode = "bad_login";
  const relay = {
    async requestSessionJson(request) {
      if (request.url.endsWith("/api/status")) return response(200, { auth_required: true, auth_providers: ["basic"], auth_flows: ["cookie"] });
      if (request.url.endsWith("/api/auth/providers")) return response(200, { providers: [{ name: "basic", display_name: "Password", supports_password: true }] });
      if (request.url.endsWith("/auth/password-login")) {
        if (mode === "bad_login") return response(401, { detail: "Invalid credentials" });
        return response(200, { ok: true }, [
          { name: "hermes_session_at", value: "access", expired: false },
          { name: "hermes_session_rt", value: "refresh", expired: false },
        ]);
      }
      if (request.url.endsWith("/api/auth/me")) {
        if (mode === "expired") return response(200, { user_id: "u", email: "", display_name: "", org_id: "", provider: "basic", expires_at: 1 });
        return response(401, { error: "session_expired" });
      }
      throw new Error("unexpected request");
    },
  };
  const auth = new DashboardAuthSession({ baseUrl: "https://hermes.example", relay });
  await auth.discover();
  await assert.rejects(auth.login({ provider: "basic", username: "admin", password: "wrong" }), (error) => error.code === "invalid_credentials");
  assert.equal(auth.snapshot.state, "logged_out");
  mode = "expired";
  await assert.rejects(auth.login({ provider: "basic", username: "admin", password: "right" }), (error) => error.code === "session_expired");
  assert.equal(auth.snapshot.state, "session_expired");
  assert.equal(auth.cookieHeaderForTest(), "");
  mode = "unauthorized";
  await assert.rejects(auth.login({ provider: "basic", username: "admin", password: "right" }), (error) => error.code === "session_expired");
  assert.equal(auth.cookieHeaderForTest(), "");
});

test("dashboard auth preserves sanitized relay launch failures during login", async () => {
  const relay = {
    async requestSessionJson(request) {
      if (request.url.endsWith("/api/status")) return response(200, { auth_required: true });
      if (request.url.endsWith("/api/auth/providers")) return response(200, { providers: [{ name: "basic", display_name: "Password", supports_password: true }] });
      const error = new Error("sensitive remote command output");
      error.code = "relay_launch_spawn_missing";
      throw error;
    },
  };
  const auth = new DashboardAuthSession({ baseUrl: "https://hermes.example", relay });
  await auth.discover();
  await assert.rejects(
    auth.login({ provider: "basic", username: "admin", password: "sentinel-password" }),
    (error) => error instanceof DashboardAuthError
      && error.code === "relay_launch_spawn_missing"
      && !error.message.includes("sensitive"),
  );
  assert.equal(auth.snapshot.state, "logged_out");
});

test("ungated dashboards and OAuth-only dashboards never expose a token fallback", async () => {
  for (const [statusBody, providerBody, expectedState] of [
    [{ auth_required: false }, null, "auth_unavailable"],
    [{ auth_required: true, auth_providers: ["nous"], auth_flows: ["cookie", "native_pkce"] }, { providers: [{ name: "nous", display_name: "Nous Research", supports_password: false }] }, "oauth_required"],
  ]) {
    const relay = {
      async requestSessionJson(request) {
        if (request.url.endsWith("/api/status")) return response(200, statusBody);
        return response(200, providerBody);
      },
    };
    const auth = new DashboardAuthSession({ baseUrl: "https://hermes.example", relay });
    assert.equal((await auth.discover()).state, expectedState);
    assert.equal(auth.cookieHeaderForTest(), "");
  }
});

test("dashboard auth mints a bounded WebSocket ticket without publishing or persisting it", async () => {
  const sentinel = "ticket_abcdefghijklmnopqrstuvwxyz0123456789";
  const relay = {
    async requestSessionJson(request) {
      if (request.url.endsWith("/api/auth/ws-ticket")) {
        assert.equal(request.method, "POST");
        assert.match(request.cookie, /hermes_session_at=access-one/);
        return response(200, { ticket: sentinel, ttl_seconds: 30 }, [
          { name: "hermes_session_at", value: "access-two", expired: false },
        ]);
      }
      throw new Error("unexpected request");
    },
  };
  const auth = DashboardAuthSession.fromSession({
    baseUrl: "https://hermes.example",
    relay,
    session: {
      version: 1,
      providers: [{ name: "basic", displayName: "Password", supportsPassword: true }],
      identity: { userId: "user-1", email: "", displayName: "Muxy User", organizationId: "", provider: "basic", expiresAt: 1 },
      cookies: [["hermes_session_at", "access-one"], ["hermes_session_rt", "refresh-one"]],
    },
  });

  const ticket = await auth.requestWebSocketTicket();

  assert.deepEqual(ticket, { ticket: sentinel, ttlSeconds: 30 });
  assert.equal(JSON.stringify(auth.snapshot).includes(sentinel), false);
  assert.equal(JSON.stringify(auth.exportSession()).includes(sentinel), false);
  assert.match(auth.cookieHeaderForTest(), /hermes_session_at=access-two/);
});

test("dashboard auth rejects malformed tickets and clears only on authoritative session rejection", async () => {
  let mode = "malformed";
  const relay = {
    async requestSessionJson() {
      if (mode === "malformed") return response(200, { ticket: "too-short", ttl_seconds: 30 });
      if (mode === "unavailable") return response(503, { detail: "offline" });
      return response(401, { detail: "expired" });
    },
  };
  const create = () => DashboardAuthSession.fromSession({
    baseUrl: "https://hermes.example",
    relay,
    session: {
      version: 1,
      providers: [{ name: "basic", displayName: "Password", supportsPassword: true }],
      identity: { userId: "user-1", email: "", displayName: "Muxy User", organizationId: "", provider: "basic", expiresAt: 1 },
      cookies: [["hermes_session_at", "access-one"], ["hermes_session_rt", "refresh-one"]],
    },
  });

  const malformed = create();
  await assert.rejects(malformed.requestWebSocketTicket(), (error) => error.code === "auth_contract_mismatch");
  assert.equal(malformed.snapshot.state, "logged_in");

  mode = "unavailable";
  const unavailable = create();
  await assert.rejects(unavailable.requestWebSocketTicket(), (error) => error.code === "websocket_ticket_failed" && error.status === 503);
  assert.equal(unavailable.snapshot.state, "logged_in");

  mode = "expired";
  const expired = create();
  await assert.rejects(expired.requestWebSocketTicket(), (error) => error.code === "session_expired");
  assert.equal(expired.snapshot.state, "session_expired");
  assert.equal(expired.cookieHeaderForTest(), "");

  mode = "relay";
  relay.requestSessionJson = async () => { throw new Error("remote command output with sensitive details"); };
  const relayFailure = create();
  await assert.rejects(
    relayFailure.requestWebSocketTicket(),
    (error) => error.code === "websocket_ticket_failed" && !error.message.includes("sensitive"),
  );
  assert.equal(relayFailure.snapshot.state, "logged_in");

  const classified = create();
  relay.requestSessionJson = async () => {
    const error = new Error("sensitive remote command output");
    error.code = "relay_launch_spawn_missing";
    throw error;
  };
  await assert.rejects(
    classified.requestWebSocketTicket(),
    (error) => error.code === "relay_launch_spawn_missing" && !error.message.includes("sensitive"),
  );
  assert.equal(classified.snapshot.state, "logged_in");
});

test("authenticated Dashboard requests serialize through cookie rotation", async () => {
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const calls = [];
  const relay = {
    async requestSessionJson(request) {
      calls.push(request);
      if (request.url.endsWith("/first")) {
        assert.match(request.cookie, /hermes_session_at=access-one/);
        await firstGate;
        return response(200, { ok: true }, [{ name: "hermes_session_at", value: "access-two", expired: false }]);
      }
      assert.match(request.cookie, /hermes_session_at=access-two/);
      return response(200, { ok: true });
    },
  };
  const auth = DashboardAuthSession.fromSession({
    baseUrl: "https://hermes.example",
    relay,
    session: {
      version: 1,
      providers: [{ name: "basic", displayName: "Password", supportsPassword: true }],
      identity: { userId: "user-1", email: "", displayName: "Muxy User", organizationId: "", provider: "basic", expiresAt: 1 },
      cookies: [["hermes_session_at", "access-one"], ["hermes_session_rt", "refresh-one"]],
    },
  });

  const first = auth.requestJson({ url: "https://hermes.example/first" });
  const second = auth.requestJson({ url: "https://hermes.example/second" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1, "the second authenticated call must wait for the first cookie merge");
  releaseFirst();
  await Promise.all([first, second]);
  assert.equal(calls.length, 2);
  assert.match(calls[1].cookie, /hermes_session_at=access-two/);
});
