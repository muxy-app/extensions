import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getListFilter,
  getPreferredCli,
  setListFilter,
  setPreferredCli,
} from "../src/lib/storage.js";

const originalMuxy = globalThis.muxy;

afterEach(() => {
  if (originalMuxy === undefined) delete globalThis.muxy;
  else globalThis.muxy = originalMuxy;
});

describe("storage preferences", () => {
  it("uses stored string values", async () => {
    globalThis.muxy = {
      storage: {
        get: async (key) => (key === "preferredCli" ? "codex" : "claude"),
        set: async () => {},
      },
    };

    assert.equal(await getPreferredCli(), "codex");
    assert.equal(await getListFilter(), "claude");
  });

  it("falls back instead of blanking the panel when reads are denied", async () => {
    globalThis.muxy = {
      storage: {
        get: async () => {
          throw new Error("permission denied (storage:read)");
        },
        set: async () => {},
      },
    };

    assert.equal(await getPreferredCli(), "grok");
    assert.equal(await getListFilter(), "all");
  });

  it("keeps preference writes non-fatal when permission is denied", async () => {
    globalThis.muxy = {
      storage: {
        get: async () => null,
        set: async () => {
          throw new Error("permission denied (storage:write)");
        },
      },
    };

    assert.equal(await setPreferredCli("codex"), false);
    assert.equal(await setListFilter("codex"), false);
  });
});
