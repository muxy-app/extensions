"use strict";

const STORAGE_PATH = ".muxy/web-browser-comments.json";
const LOCAL_FALLBACK_KEY = "muxy.web-browser.annotations.v1";
const SCHEMA_VERSION = 1;
const WRITE_DEBOUNCE_MS = 500;

export function initAnnotations(deps) {
  const {
    layer,
    annotateBtn,
    exportBtn,
    countBadge,
    popover,
    popoverTitle,
    textArea,
    saveBtn,
    cancelBtn,
    deleteBtn,
    toast,
    viewport,
    getCurrentURL,
  } = deps;

  let store = { version: SCHEMA_VERSION, byUrl: {} };
  let currentURL = null;
  let arming = false;
  let activePinId = null;
  let writeTimer = null;
  let toastTimer = null;
  let storageMode = "files"; // "files" | "local"

  loadStore().then(() => {
    renderCurrentURL();
  });

  annotateBtn.addEventListener("click", () => setArming(!arming));
  exportBtn.addEventListener("click", () => exportForAgent());

  layer.addEventListener("click", (event) => {
    if (!arming) return;
    if (event.target !== layer) return;
    const rect = layer.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const xPct = ((event.clientX - rect.left) / rect.width) * 100;
    const yPct = ((event.clientY - rect.top) / rect.height) * 100;
    const pin = createPin(xPct, yPct);
    addPin(pin);
    setArming(false);
    openPopover(pin.id, { focusText: true });
  });

  saveBtn.addEventListener("click", () => {
    if (!activePinId) return;
    updatePin(activePinId, { text: textArea.value });
    closePopover();
    showToast("Comment saved");
  });

  cancelBtn.addEventListener("click", () => closePopover());

  deleteBtn.addEventListener("click", () => {
    if (!activePinId) return;
    removePin(activePinId);
    closePopover();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!popover.hidden) {
        closePopover();
      } else if (arming) {
        setArming(false);
      }
    }
  });

  document.addEventListener("mousedown", (event) => {
    if (popover.hidden) return;
    if (popover.contains(event.target)) return;
    if (event.target.classList && event.target.classList.contains("annotation-pin")) return;
    closePopover();
  });

  return {
    setURL(url) {
      currentURL = url;
      renderCurrentURL();
    },
  };

  // ----- state -----

  function entryForURL(url) {
    if (!url) return null;
    let entry = store.byUrl[url];
    if (!entry) {
      entry = { url, pins: [], updatedAt: 0 };
      store.byUrl[url] = entry;
    }
    return entry;
  }

  function pinsForCurrent() {
    const entry = entryForURL(currentURL);
    return entry ? entry.pins : [];
  }

  function createPin(xPct, yPct) {
    return {
      id: randomId(),
      xPct: round(xPct),
      yPct: round(yPct),
      text: "",
      createdAt: nowMs(),
    };
  }

  function addPin(pin) {
    const entry = entryForURL(currentURL);
    if (!entry) return;
    entry.pins.push(pin);
    entry.updatedAt = nowMs();
    schedulePersist();
    renderPins();
  }

  function updatePin(id, patch) {
    const entry = entryForURL(currentURL);
    if (!entry) return;
    const pin = entry.pins.find((p) => p.id === id);
    if (!pin) return;
    Object.assign(pin, patch);
    entry.updatedAt = nowMs();
    schedulePersist();
    renderPins();
  }

  function removePin(id) {
    const entry = entryForURL(currentURL);
    if (!entry) return;
    entry.pins = entry.pins.filter((p) => p.id !== id);
    entry.updatedAt = nowMs();
    if (entry.pins.length === 0) {
      delete store.byUrl[currentURL];
    }
    schedulePersist();
    renderPins();
  }

  // ----- render -----

  function renderCurrentURL() {
    const url = getCurrentURL();
    currentURL = url || null;
    renderPins();
  }

  function renderPins() {
    const pins = pinsForCurrent();
    const existing = new Map();
    layer.querySelectorAll(".annotation-pin").forEach((el) => existing.set(el.dataset.pinId, el));

    pins.forEach((pin, index) => {
      let el = existing.get(pin.id);
      if (!el) {
        el = document.createElement("button");
        el.type = "button";
        el.className = "annotation-pin";
        el.dataset.pinId = pin.id;
        el.addEventListener("click", (event) => {
          event.stopPropagation();
          openPopover(pin.id);
        });
        layer.appendChild(el);
      } else {
        existing.delete(pin.id);
      }
      el.textContent = String(index + 1);
      el.style.left = pin.xPct + "%";
      el.style.top = pin.yPct + "%";
      el.title = pin.text ? pin.text : "Empty pin";
      el.setAttribute("aria-label", `Pin ${index + 1}${pin.text ? ": " + pin.text : ""}`);
    });

    existing.forEach((el) => el.remove());

    updateBadge(pins.length);
    exportBtn.disabled = pins.length === 0;
  }

  function updateBadge(count) {
    if (count > 0) {
      countBadge.textContent = String(count);
      countBadge.hidden = false;
    } else {
      countBadge.hidden = true;
    }
  }

  function setArming(value) {
    arming = !!value;
    layer.classList.toggle("is-arming", arming);
    layer.setAttribute("aria-hidden", arming ? "false" : "true");
    annotateBtn.classList.toggle("is-active", arming);
    annotateBtn.setAttribute("aria-pressed", arming ? "true" : "false");
  }

  // ----- popover -----

  function openPopover(pinId, opts) {
    const pin = pinsForCurrent().find((p) => p.id === pinId);
    if (!pin) return;
    activePinId = pinId;
    const index = pinsForCurrent().findIndex((p) => p.id === pinId);

    popoverTitle.textContent = `Pin ${index + 1}`;
    textArea.value = pin.text || "";

    layer.querySelectorAll(".annotation-pin.is-open").forEach((el) => el.classList.remove("is-open"));
    const pinEl = layer.querySelector(`[data-pin-id="${pinId}"]`);
    if (pinEl) pinEl.classList.add("is-open");

    popover.hidden = false;
    positionPopover(pinEl);

    if (opts && opts.focusText) {
      requestAnimationFrame(() => textArea.focus());
    } else {
      requestAnimationFrame(() => textArea.focus());
    }
  }

  function positionPopover(pinEl) {
    if (!pinEl) return;
    const viewportRect = viewport.getBoundingClientRect();
    const pinRect = pinEl.getBoundingClientRect();
    popover.style.visibility = "hidden";
    popover.style.left = "0px";
    popover.style.top = "0px";

    const popRect = popover.getBoundingClientRect();
    const margin = 8;

    let left = pinRect.left - viewportRect.left + pinRect.width + margin;
    if (left + popRect.width + margin > viewportRect.width) {
      left = pinRect.left - viewportRect.left - popRect.width - margin;
    }
    if (left < margin) left = margin;

    let top = pinRect.top - viewportRect.top - margin;
    if (top + popRect.height + margin > viewportRect.height) {
      top = viewportRect.height - popRect.height - margin;
    }
    if (top < margin) top = margin;

    popover.style.left = left + "px";
    popover.style.top = top + "px";
    popover.style.visibility = "visible";
  }

  function closePopover() {
    activePinId = null;
    popover.hidden = true;
    layer.querySelectorAll(".annotation-pin.is-open").forEach((el) => el.classList.remove("is-open"));
  }

  // ----- export -----

  function exportForAgent() {
    const entry = entryForURL(currentURL);
    if (!entry || entry.pins.length === 0) return;
    const rect = viewport.getBoundingClientRect();
    const lines = [];
    lines.push(`# Page annotations`);
    lines.push("");
    lines.push(`- URL: ${entry.url}`);
    lines.push(`- Viewport: ${Math.round(rect.width)}x${Math.round(rect.height)}px`);
    lines.push(`- Captured: ${new Date(entry.updatedAt || nowMs()).toISOString()}`);
    lines.push("");
    lines.push(`## Pins`);
    lines.push("");
    entry.pins.forEach((pin, index) => {
      lines.push(`### Pin ${index + 1}`);
      lines.push(`- Position: ${pin.xPct}% from left, ${pin.yPct}% from top`);
      lines.push(`- Comment: ${pin.text ? pin.text : "_(no comment)_"}`);
      lines.push("");
    });

    const markdown = lines.join("\n");
    copyToClipboard(markdown)
      .then(() => showToast(`Copied ${entry.pins.length} pin${entry.pins.length === 1 ? "" : "s"}`))
      .catch(() => showToast("Copy failed"));
  }

  // ----- persistence -----

  async function loadStore() {
    const fromFile = await readFromFiles();
    if (fromFile) {
      store = fromFile;
      return;
    }
    const fromLocal = readFromLocal();
    if (fromLocal) {
      store = fromLocal;
      return;
    }
    store = { version: SCHEMA_VERSION, byUrl: {} };
  }

  async function readFromFiles() {
    if (!hasMuxyFiles()) {
      storageMode = "local";
      return null;
    }
    try {
      const result = await window.muxy.files.read(STORAGE_PATH);
      const content = result && typeof result.content === "string" ? result.content : null;
      if (!content) return null;
      return normalizeStore(JSON.parse(content));
    } catch (_error) {
      // file likely missing; treat as empty
      return null;
    }
  }

  function readFromLocal() {
    try {
      const raw = localStorage.getItem(LOCAL_FALLBACK_KEY);
      if (!raw) return null;
      return normalizeStore(JSON.parse(raw));
    } catch (_error) {
      return null;
    }
  }

  function schedulePersist() {
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(persist, WRITE_DEBOUNCE_MS);
  }

  async function persist() {
    writeTimer = null;
    const payload = JSON.stringify(store, null, 2);
    if (storageMode === "files" && hasMuxyFiles()) {
      try {
        await ensureMuxyDir();
        await window.muxy.files.write(STORAGE_PATH, payload);
        return;
      } catch (_error) {
        storageMode = "local";
      }
    }
    try {
      localStorage.setItem(LOCAL_FALLBACK_KEY, payload);
    } catch (_error) {}
  }

  async function ensureMuxyDir() {
    if (!hasMuxyFiles()) return;
    try {
      await window.muxy.files.stat(".muxy");
    } catch (_error) {
      try {
        await window.muxy.files.mkdir(".muxy");
      } catch (_e2) {}
    }
  }

  function normalizeStore(data) {
    if (!data || typeof data !== "object") return null;
    const byUrl = {};
    const source = data.byUrl && typeof data.byUrl === "object" ? data.byUrl : {};
    Object.entries(source).forEach(([url, entry]) => {
      if (!entry || typeof entry !== "object" || !Array.isArray(entry.pins)) return;
      const pins = entry.pins
        .filter((p) => p && typeof p === "object")
        .map((p) => ({
          id: typeof p.id === "string" ? p.id : randomId(),
          xPct: clampPct(p.xPct),
          yPct: clampPct(p.yPct),
          text: typeof p.text === "string" ? p.text : "",
          createdAt: Number.isFinite(p.createdAt) ? p.createdAt : nowMs(),
        }));
      if (pins.length === 0) return;
      byUrl[url] = {
        url,
        pins,
        updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : nowMs(),
      };
    });
    return { version: SCHEMA_VERSION, byUrl };
  }

  // ----- utils -----

  function showToast(text) {
    toast.textContent = text;
    toast.classList.add("is-shown");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-shown"), 1800);
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error("execCommand failed"));
      } catch (err) {
        reject(err);
      }
    });
  }

  function hasMuxyFiles() {
    return !!(window.muxy && window.muxy.files && typeof window.muxy.files.write === "function");
  }

  function clampPct(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > 100) return 100;
    return round(n);
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function randomId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "p_" + Math.random().toString(36).slice(2, 10) + nowMs().toString(36);
  }

  function nowMs() {
    return Date.now();
  }
}
