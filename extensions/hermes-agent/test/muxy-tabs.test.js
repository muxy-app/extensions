import assert from "node:assert/strict";
import test from "node:test";

import { openProjectBoardTab, projectBoardTabRequest } from "../src/muxy-tabs.js";

test("project board tab requests use Muxy's extension-webview contract", () => {
  assert.deepEqual(projectBoardTabRequest("muxy-hermes-extension"), {
    kind: "extensionWebView",
    extension: {
      id: "muxy-hermes-extension",
      tabType: "hermes-project-board",
      singleton: true,
    },
  });
});

test("opening the project board delegates the validated request to Muxy", async () => {
  const calls = [];
  const muxy = {
    extensionID: "muxy-hermes-extension",
    tabs: {
      async open(request) {
        calls.push(request);
        return "board-tab-id";
      },
    },
  };

  assert.equal(await openProjectBoardTab(muxy), "board-tab-id");
  assert.deepEqual(calls, [projectBoardTabRequest("muxy-hermes-extension")]);
});

test("opening the project board fails clearly when the Muxy bridge is unavailable", async () => {
  await assert.rejects(() => openProjectBoardTab(null), /Muxy tab bridge is unavailable/);
});
