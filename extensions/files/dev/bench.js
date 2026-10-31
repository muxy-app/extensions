// Dev-only benchmarks, driven from a browser console or agent-browser `eval`.
// They only touch DOM contracts both the old and new implementations share
// (`[role=tree]`, `[data-path]` rows, `.cm-content`), so the same script can
// compare builds. Every run reports main-thread jank via a rAF frame sampler.
(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

  const longTasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(entry.duration);
    }).observe({ type: "longtask", buffered: true });
  } catch {}

  const eventTimings = [];
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === "keydown" || entry.name === "keypress" || entry.name === "beforeinput" || entry.name === "input") {
          eventTimings.push({ name: entry.name, duration: entry.duration, processing: entry.processingEnd - entry.processingStart });
        }
      }
    }).observe({ type: "event", buffered: true, durationThreshold: 16 });
  } catch {}

  window.__firstRowAt = null;
  new MutationObserver((_, observer) => {
    if (document.querySelector("[role=treeitem]") || document.querySelector(".cm-line")) {
      window.__firstRowAt = performance.now();
      observer.disconnect();
    }
  }).observe(document, { childList: true, subtree: true });

  function sampler() {
    const frames = [];
    let last = performance.now();
    let running = true;
    const tick = (now) => {
      frames.push(now - last);
      last = now;
      if (running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => {
      running = false;
      const sorted = [...frames].sort((a, b) => a - b);
      const pct = (p) => +(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0).toFixed(1);
      return { frames: frames.length, p50: pct(0.5), p95: pct(0.95), max: pct(1), janky: frames.filter((f) => f > 34).length };
    };
  }

  const round = (n) => +n.toFixed(1);
  const tree = () => document.querySelector("[role=tree]");
  const rowCount = () => document.querySelectorAll("[role=treeitem]:not([hidden])").length;

  function scroller() {
    const candidates = [tree(), ...document.querySelectorAll("*")];
    for (const el of candidates) {
      if (!el) continue;
      const style = getComputedStyle(el);
      if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 4) return el;
    }
    return document.scrollingElement;
  }

  function key(name, opts = {}) {
    const target = document.activeElement ?? tree();
    target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...opts }));
  }

  async function settle(latency = 20) {
    await frame();
    await sleep(latency);
    await frame();
  }

  window.__bench = {
    longTasks,
    eventTimings,

    load() {
      return { firstRowMs: window.__firstRowAt && round(window.__firstRowAt), rows: rowCount() };
    },

    async expand(path) {
      const row = document.querySelector(`[data-path="${CSS.escape(path)}"]:not([hidden])`);
      if (!row) return { error: `no row ${path}` };
      const before = rowCount();
      const stop = sampler();
      const t0 = performance.now();
      row.click();
      while (rowCount() <= before && performance.now() - t0 < 5000) await new Promise((r) => requestAnimationFrame(r));
      await frame();
      return { ms: round(performance.now() - t0), rows: rowCount(), ...stop() };
    },

    // Walk the tree with the keyboard, expanding every folder it meets
    // (Right, then Down), the way a user arrowing through a project would.
    async walk(steps = 600) {
      tree()?.focus();
      key("Home");
      await settle();
      const stop = sampler();
      const tasksBefore = longTasks.length;
      let sync = 0;
      let worst = 0;
      const t0 = performance.now();
      for (let i = 0; i < steps; i++) {
        let s = performance.now();
        key("ArrowRight");
        let d = performance.now() - s;
        await settle(6);
        s = performance.now();
        key("ArrowDown");
        d += performance.now() - s;
        sync += d;
        worst = Math.max(worst, d);
        await frame();
      }
      return {
        totalMs: round(performance.now() - t0),
        keyHandlerMsTotal: round(sync),
        keyHandlerMsWorst: round(worst),
        longTasks: longTasks.length - tasksBefore,
        longTaskMs: round(longTasks.slice(tasksBefore).reduce((a, b) => a + b, 0)),
        domRows: rowCount(),
        ...stop(),
      };
    },

    async scroll(steps = 120) {
      const el = scroller();
      el.scrollTop = 0;
      await settle();
      const max = el.scrollHeight - el.clientHeight;
      const stop = sampler();
      for (let i = 1; i <= steps; i++) {
        el.scrollTop = (max * i) / steps;
        await new Promise((r) => requestAnimationFrame(r));
      }
      await frame();
      return { scrollHeight: el.scrollHeight, domRows: rowCount(), ...stop() };
    },

    async flood(count = 2000) {
      const stop = sampler();
      const tasksBefore = longTasks.length;
      const t0 = performance.now();
      window.__mock.flood(count);
      const syncMs = performance.now() - t0;
      await sleep(1500);
      return {
        syncMs: round(syncMs),
        longTasks: longTasks.length - tasksBefore,
        longTaskMs: round(longTasks.slice(tasksBefore).reduce((a, b) => a + b, 0)),
        ...stop(),
      };
    },

    // Type into CodeMirror through the real input path (beforeinput/input on
    // the contenteditable), one character per frame like a fast typist.
    async type(text = "const value = 42; ".repeat(6), { keepFrames = false } = {}) {
      const content = document.querySelector(".cm-content");
      if (!content) return { error: "no editor" };
      content.focus();
      const stop = sampler();
      const tasksBefore = longTasks.length;
      const perKey = [];
      for (const ch of text) {
        const t0 = performance.now();
        document.execCommand("insertText", false, ch);
        await new Promise((r) => requestAnimationFrame(r));
        perKey.push(performance.now() - t0);
        await sleep(0);
      }
      await sleep(1600);
      const sorted = [...perKey].sort((a, b) => a - b);
      const pct = (p) => round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]);
      return {
        keys: perKey.length,
        keyToFrameP50: pct(0.5),
        keyToFrameP95: pct(0.95),
        keyToFrameMax: pct(1),
        longTasks: longTasks.length - tasksBefore,
        longTaskMs: round(longTasks.slice(tasksBefore).reduce((a, b) => a + b, 0)),
        ...(keepFrames ? stop() : (stop(), {})),
      };
    },
  };
})();
