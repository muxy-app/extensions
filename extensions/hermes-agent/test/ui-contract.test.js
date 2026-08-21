import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("marketplace identity, metadata, and permissions are frozen", async () => {
  const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.equal(manifest.name, "hermes-agent");
  assert.equal(manifest.version, "0.1.0");
  assert.equal(manifest.engines.node, ">=20");
  assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0);
  assert.deepEqual(manifest.muxy.marketplace, {
    author: "Gabe",
    categories: ["developer-tools", "productivity"],
    github: "gabeosx",
    icon: "assets/icon.svg",
    repository: "https://github.com/gabeosx/muxy-hermes-extension",
    screenshots: [
      "assets/screenshots/screenshot-1.png",
      "assets/screenshots/screenshot-2.png",
      "assets/screenshots/screenshot-3.png",
      "assets/screenshots/screenshot-4.png",
    ],
  });
  assert.deepEqual(manifest.muxy.permissions, ["commands:exec", "panels:write", "storage:read", "storage:write", "tabs:write"]);
  for (const forbidden of ["background", "events", "scripts", "topbarItems", "statusbarItems"]) {
    assert.equal(Object.hasOwn(manifest.muxy, forbidden), false);
  }
});

test("product source contains only the Dashboard session relay contract", async () => {
  const [relay, auth, gateway, dom, icons] = await Promise.all([
    readFile(new URL("src/curl-relay.js", root), "utf8"),
    readFile(new URL("src/dashboard-auth.js", root), "utf8"),
    readFile(new URL("src/dashboard-gateway.js", root), "utf8"),
    readFile(new URL("src/lib/dom.js", root), "utf8"),
    readFile(new URL("src/lib/icons.js", root), "utf8"),
  ]);
  assert.match(relay, /requestSessionJson/);
  assert.match(relay, /const stdin = buildSessionConfig/);
  assert.match(relay, /this\.exec\(argv, \{\s*stdin,/);
  assert.doesNotMatch(relay, /bearer|text\/event-stream|streamJournal|journal|Authorization:/i);
  assert.match(auth, /requestWebSocketTicket/);
  assert.match(gateway, /authSession\.requestWebSocketTicket\(\)/);
  assert.doesNotMatch(dom, /innerHTML|\bhtml\b/);
  assert.match(icons, /svg\.innerHTML = ICONS\[name\]/);
});

test("OAuth-only providers and password security boundaries are explicit in both surfaces", async () => {
  const [panel, board, readme] = await Promise.all([
    readFile(new URL("src/panel/app.js", root), "utf8"),
    readFile(new URL("src/board/app.js", root), "utf8"),
    readFile(new URL("README.md", root), "utf8"),
  ]);
  for (const source of [panel, board]) {
    assert.match(source, /OAuth\/OIDC not supported/);
    assert.match(source, /password sign-in only/);
    assert.match(source, /trusted network, VPN, or operator-controlled connection/);
    assert.match(source, /Muxy SSH workspaces are not supported in this beta/);
    assert.match(source, /type: "password"/);
  }
  for (const heading of ["Agent runs and approvals", "Kanban boards", "Compatibility", "Security", "Permissions", "Privacy", "Troubleshooting", "Uninstalling"]) {
    assert.match(readme, new RegExp(heading));
  }
  assert.match(readme, /Hermes Agent.*is an open-source AI agent/);
  assert.match(readme, /This extension connects Muxy to the Hermes Dashboard you already have/);
  assert.doesNotMatch(readme, /candidate Muxy marketplace beta|support contract/i);
  assert.match(readme, /Muxy 1\.5\.0 \(945\)/);
  assert.match(readme, /Hermes 0\.20\.2/);
  assert.match(readme, /No analytics or telemetry/);
  assert.match(readme, /assets\/readme\/operations\.png/);
  assert.match(readme, /assets\/readme\/agent-approval\.png/);
  assert.match(readme, /assets\/readme\/project-board\.png/);
  assert.doesNotMatch(readme, /assets\/demo\/|<video|\.gif|\.mp4/i);
  assert.match(readme, /Hermes starts a worker, links its run to the card, and moves the card to Running/);
  assert.match(readme, /The board refreshes automatically/);
  assert.match(readme, /Requests started in the Agent panel stay separate and are not turned into cards/);
  assert.match(readme, /closing the Muxy board does not stop them/);
  assert.doesNotMatch(readme, /Cards move only when you choose|does not automatically attach an agent request to a card/);
});

test("native styles retain themes, focus, responsive scale, and reduced motion", async () => {
  const [panelCss, boardCss] = await Promise.all([
    readFile(new URL("src/styles/global.css", root), "utf8"),
    readFile(new URL("src/styles/board.css", root), "utf8"),
  ]);
  for (const css of [panelCss, boardCss]) {
    assert.match(css, /var\(--muxy-background\)/);
    assert.match(css, /var\(--muxy-accent\)/);
    assert.match(css, /:focus-visible/);
    assert.match(css, /prefers-reduced-motion:\s*reduce/);
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
    assert.doesNotMatch(css, /--muxy-diff-delete/);
  }
  assert.match(boardCss, /@media \(max-width:\s*720px\)/);
  assert.match(panelCss, /overflow-y:\s*auto/);
});

test("native mutation controls provide compact empty states, global pending state, and stop confirmation", async () => {
  const [panel, board, boardCss, stopConfirmation] = await Promise.all([
    readFile(new URL("src/panel/app.js", root), "utf8"),
    readFile(new URL("src/board/app.js", root), "utf8"),
    readFile(new URL("src/styles/board.css", root), "utf8"),
    readFile(new URL("src/stop-confirmation.js", root), "utf8"),
  ]);
  assert.match(stopConfirmation, /Stop this Hermes run\?/);
  assert.match(panel, /agent\.runGeneration === runGeneration/);
  assert.match(board, /disabled: Boolean\(this\.pendingTaskId\)/);
  assert.match(board, /"aria-busy": Boolean\(this\.pendingTaskId\)/);
  assert.match(board, /Add one or move a card here\./);
  assert.match(boardCss, /\.board-column-empty/);
  assert.match(boardCss, /scrollbar-gutter:\s*stable/);
});
