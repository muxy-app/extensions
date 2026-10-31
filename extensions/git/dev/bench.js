(() => {
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const until = async (fn, timeout = 10000) => {
    const start = performance.now();
    while (!fn()) {
      if (performance.now() - start > timeout) throw new Error("timeout");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  const rows = () => document.querySelectorAll(".changes .row:not([hidden])").length;
  window.__bench = {
    async load() {
      const start = performance.now();
      await until(() => rows() > 0);
      return { firstRowsMs: Math.round(performance.now() - start - (window.__loadOffset ?? 0)), rows: rows() };
    },
    async refresh(changes = 4000) {
      const before = { ...__mock.calls };
      __mock.seed(changes);
      const start = performance.now();
      await until(() => document.querySelector(".tab-count")?.textContent === String(changes));
      await frame();
      return { ms: Math.round(performance.now() - start), statusCalls: (__mock.calls.status ?? 0) - (before.status ?? 0), domRows: document.querySelectorAll(".changes .row").length };
    },
    async flood(n = 2000) {
      const before = __mock.calls.status ?? 0;
      const start = performance.now();
      __mock.flood(n);
      const blocking = Math.round(performance.now() - start);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return { blockingMs: blocking, statusCalls: (__mock.calls.status ?? 0) - before };
    },
    async scroll() {
      const list = document.querySelector(".changes .list");
      const times = [];
      let last = performance.now();
      for (let top = 0; top < list.scrollHeight; top += 240) {
        list.scrollTop = top;
        await frame();
        const now = performance.now();
        times.push(now - last);
        last = now;
      }
      times.sort((a, b) => a - b);
      return { frames: times.length, p50: +times[Math.floor(times.length / 2)].toFixed(1), p95: +times[Math.floor(times.length * 0.95)].toFixed(1) };
    },
  };
})();
