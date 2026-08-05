let importSerial = 0;
let jobSerial = 0;

function importPath(name) {
  importSerial += 1;
  return `../scripts/find-in-files.js?case=${name}-${importSerial}`;
}

export async function openRunScript(name) {
  const runner = await import("../scripts/find-in-files/runner.js");
  runner.reset_find_in_files_state_for_tests();
  await import(importPath(name));
}

/**
 * Wrap a synchronous muxy.exec-style implementation as a muxy.execAsync handle.
 * `impl(argv, options)` runs synchronously (returns a value or throws), and the
 * handle's `result` promise resolves/rejects accordingly. `cancel()` is a no-op
 * since a synchronous impl settles immediately.
 */
export function execAsyncFromSync(impl) {
  return (argv, options) => {
    const id = `job-${jobSerial++}`;
    let resultPromise;
    try {
      const value = impl(argv, options);
      resultPromise = Promise.resolve(value);
    } catch (error) {
      resultPromise = Promise.reject(error);
    }
    return {
      id,
      result: resultPromise,
      cancel() {
        return false;
      },
    };
  };
}

export async function runModalQuery(modalOptions, query, options) {
  const emittedItems = [];
  const immediateItems = modalOptions.onQuery(
    query,
    (items) => {
      emittedItems.push(...items);
    },
    options,
  );
  if (immediateItems && typeof immediateItems.then === "function") {
    await immediateItems;
  } else {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { immediateItems, emittedItems };
}
