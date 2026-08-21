import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

class FakeNode {
  constructor(text = "") {
    this.children = [];
    this.text = text;
    this.attributes = new Map();
    this.className = "";
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  addEventListener() {}

  get textContent() {
    return `${this.text}${this.children.map((child) => child.textContent).join("")}`;
  }
}

function installFakeDom() {
  const previous = { Node: globalThis.Node, document: globalThis.document };
  class FakeElement extends FakeNode {}
  globalThis.Node = FakeNode;
  globalThis.document = {
    createElement: () => new FakeElement(),
    createTextNode: (value) => new FakeNode(String(value)),
  };
  return () => {
    globalThis.Node = previous.Node;
    globalThis.document = previous.document;
  };
}

test("OAuth/OIDC-only Dashboard state renders explicit unsupported guidance in both surfaces", async () => {
  const restore = installFakeDom();
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom" });
  try {
    const [{ HermesGatewayPanel }, { HermesProjectBoard }] = await Promise.all([
      vite.ssrLoadModule("/src/panel/app.js"),
      vite.ssrLoadModule("/src/board/app.js"),
    ]);
    const unsupported = Object.freeze({ state: "oauth_required", providers: Object.freeze([]), identity: null, label: "" });
    const panel = new HermesGatewayPanel(new FakeNode());
    panel.authSnapshot = unsupported;
    const board = new HermesProjectBoard(new FakeNode());
    board.authSnapshot = unsupported;

    for (const view of [panel.view(), board.view()]) {
      assert.match(view.textContent, /OAuth\/OIDC not supported/);
      assert.match(view.textContent, /provider-advertised password sign-in only/);
      assert.match(view.textContent, /Hermes Dashboard directly for OAuth or OIDC/);
    }
  } finally {
    await vite.close();
    restore();
  }
});
