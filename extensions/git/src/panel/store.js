export function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    set(patch) {
      let changed = false;
      for (const key of Object.keys(patch)) {
        if (state[key] !== patch[key]) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      const prev = state;
      state = { ...state, ...patch };
      for (const listener of [...listeners]) listener(state, prev);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function onFrame(fn) {
  let frame = 0;
  return () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      fn();
    });
  };
}
