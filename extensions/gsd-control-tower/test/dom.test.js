import { test } from "node:test";
import assert from "node:assert/strict";
import { h } from "../src/lib/dom.js";

test("ARIA and data booleans keep true/false strings while native flags use presence", () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({
    attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; },
  }) };
  try {
    const enabled = h("button", { "aria-checked": true, "data-on": true, disabled: true });
    assert.deepEqual(enabled.attributes, { "aria-checked": "true", "data-on": "true", disabled: "" });
    const disabled = h("button", { "aria-checked": false, "data-on": false, disabled: false });
    assert.deepEqual(disabled.attributes, { "aria-checked": "false", "data-on": "false" });
  } finally { globalThis.document = previous; }
});
