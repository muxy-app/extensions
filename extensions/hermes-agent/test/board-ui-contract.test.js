import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the project board is a responsive Muxy tab rather than a second chat client", async () => {
  const [app, css, html] = await Promise.all([
    readFile(new URL("../src/board/app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/board.css", import.meta.url), "utf8"),
    readFile(new URL("../board/index.html", import.meta.url), "utf8"),
  ]);

  for (const copy of [
    "Connect to Hermes",
    "Start by choosing the Dashboard you want to sign in to.",
    "Check sign-in",
    "Sign in and choose a board",
    "Choose a board",
    "No boards are available",
    "Open board",
    "Signed in as",
    "Sign-in expired",
    "OAuth/OIDC not supported",
    "You’ll stay signed in on this Mac until you log out. Use password sign-in only on a trusted network, VPN, or operator-controlled connection.",
    "Add card",
    "Task title",
    "Task instructions",
    "Hermes assignee",
  ]) assert.match(app, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.match(app, /type: "password", autocomplete: "current-password"/);
  assert.match(app, /this\.passwordValue = ""/);
  assert.match(app, /DashboardAuthSession/);
  assert.match(app, /SessionBrokerClient/);
  assert.match(app, /restoreSavedSession/);
  assert.match(app, /persistSession/);
  assert.match(app, /verifySavedSession/);
  assert.match(app, /SESSION_CHECK_INTERVAL_MS/);
  assert.match(app, /authSnapshot\.state === "logged_in"/);
  assert.match(app, /listBoards/);
  assert.match(app, /BOARD_REFRESH_INTERVAL_MS/);
  assert.match(app, /refresh\(\{ silent: true \}\)/);
  assert.match(app, /boardRefreshInFlight/);
  assert.match(app, /assignee: this\.createAssignee \|\| null/);
  assert.match(app, /body: this\.createBody/);
  assert.match(app, /selectBoardSlug/);
  assert.match(app, /openBoard/);
  assert.doesNotMatch(app, /id: "board-slug"/);
  assert.doesNotMatch(app, /Dashboard session token|session token|tokenValue|dashboard-token/i);
  assert.doesNotMatch(app, /localStorage|sessionStorage|muxy\.storage|workspace path|session token|dashboard-token/i);
  assert.doesNotMatch(app, /chat|transcript|file browser/i);
  assert.match(html, /src="\/src\/board-main\.js"/);

  assert.match(css, /var\(--muxy-topbar-height\)/);
  assert.match(css, /\.board-columns\s*\{[\s\S]*?display:\s*flex/);
  assert.match(css, /\.board-columns\s*\{[\s\S]*?align-items:\s*stretch/);
  assert.match(css, /overflow:\s*auto/);
  assert.match(css, /@media \(max-width:\s*720px\)/);
  assert.match(css, /@media \(max-width:\s*720px\)\s*\{[\s\S]*?\.board-columns\s*\{[\s\S]*?flex-direction:\s*column/);
  assert.match(css, /overflow-y:\s*auto/);
  assert.match(css, /min-height:\s*0/);
  assert.match(css, /board-session/);
  assert.match(css, /board-task-instructions/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});
