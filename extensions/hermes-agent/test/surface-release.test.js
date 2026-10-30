import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

test("closing either surface releases authentication and prevents a pending storage restore from reopening it", async () => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom" });
  try {
    const { HermesGatewayPanel } = await vite.ssrLoadModule("/src/panel/app.js");
    const { HermesProjectBoard } = await vite.ssrLoadModule("/src/board/app.js");
    for (const Surface of [HermesGatewayPanel, HermesProjectBoard]) {
      let finishRead;
      let released = 0;
      const surface = new Surface({});
      surface.render = () => {};
      surface.authSession = { release() { released += 1; } };
      surface.sessionBroker = { readDashboard: () => new Promise((resolve) => { finishRead = resolve; }) };
      const initialUrl = surface.urlValue;
      const restoring = surface.restoreSavedSession();
      await surface.release();
      finishRead({ baseUrl: "https://late-hermes.example", auth: {} });
      await restoring;
      assert.equal(released, 1, Surface.name);
      assert.equal(surface.released, true);
      assert.equal(surface.urlValue, initialUrl, "a closed surface must not restore another connection");
      assert.equal(surface.sessionCheckTimer, null);
    }
  } finally {
    await vite.close();
  }
});
