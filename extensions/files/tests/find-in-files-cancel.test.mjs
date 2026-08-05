import assert from "node:assert/strict";
import test from "node:test";

import { openRunScript } from "./find-in-files-test-utils.mjs";

test("Find in Files cancels the running search when a new query arrives", async () => {
  let modalOptions = null;
  let settleFirst;
  const handles = [];
  const emissions = [];
  globalThis.muxy = {
    modal: { open(o) { modalOptions = o; } },
    execAsync(_argv, _opts) {
      const id = `job-${handles.length}`;
      // result promise is externally controlled so the exec stays "running"
      const result = new Promise((res, rej) => { settleFirst = { res, rej }; });
      const handle = {
        id,
        result,
        cancelled: false,
        cancel() {
          handle.cancelled = true;
          settleFirst?.rej(new Error("cancelled"));
          return true;
        },
      };
      handles.push(handle);
      return handle;
    },
  };

  try {
    await openRunScript("cancel-running");

    const alphaPromise = modalOptions.onQuery("alpha", (items) => {
      emissions.push({ q: "alpha", items });
    });

    // Let the deferred task run so the alpha exec handle is created and awaited.
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(handles.length, 1);

    // A new query must cancel the running exec, not block on it.
    modalOptions.onQuery("beta", (items) => {
      emissions.push({ q: "beta", items });
    });

    assert.equal(handles[0].cancelled, true);
    // The stale alpha result must never be emitted (serial mismatch).
    assert.deepEqual(emissions, []);

    // Drain the beta task and settle its handle before teardown.
    await new Promise((resolve) => setTimeout(resolve, 0));
    settleFirst?.res({ exitCode: 0, stdout: "" });

    await alphaPromise.catch(() => {});
  } finally {
    delete globalThis.muxy;
  }
});
