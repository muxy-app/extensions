// Lookup modal page — opened natively by the ⌘⌃K openModal command action.
// This is our own picker: search box (pre-filled from the clipboard when it
// holds a just-selected command name), results across tldr + man, and inline
// rendering. It runs as a normal webview page, so the full async muxy bridge
// (exec, storage, http) applies — none of the background bridge's limits.
import "@/lookup/lookup.css";
import { h, clear } from "@/lib/dom";
import { refTitle } from "@/shared/refs";
import {
  fetchDoc, loadConfig, updateTldrCache, pushRecent,
  getRecents, getFavorites, toggleFavorite, isFavorite,
  listTldrRows, listManRows, searchContents, CONTENT_MIN, SourceError,
} from "@/shared/sources";
import { renderSettings } from "@/shared/settings";
import { renderTldr, renderManHtml, renderManPre, copyExample } from "@/shared/render";

const MAX_RESULTS = 250;
// Content search shells out to grep over the whole man tree, so it waits for a
// pause in typing rather than firing per keystroke.
const CONTENT_DEBOUNCE = 350;

const root = document.getElementById("root");
let config = null;
let rows = [];            // grows progressively: tldr fast, man ~1.3s later
let rowsReady = false;
let query = "";
let prefill = null;       // clipboard-derived initial query, if any
let selected = 0;
let mode = "list";
let currentDoc = null;
let searchToken = 0;
let input = null;
let contentSearch = false; // "Search contents" — session-local, defaults off
let searchTimer = null;

init();

async function init() {
  config = await loadConfig();
  contentSearch = !!config.contentSearchDefault;
  renderList();
  muxy.onFocus?.((focused) => {
    if (focused && mode === "list") input?.focus();
  });

  // Pre-fill from the clipboard (Muxy's "Auto-copy terminal selection"
  // setting puts highlighted text there). Runs in parallel with row loading.
  selectionQuery().then((sel) => {
    if (!sel || query) return;
    prefill = sel;
    query = sel;
    if (input) {
      input.value = sel;
      input.select();
    }
    refreshResults();
  });

  loadRows();
}

async function loadRows() {
  const tldrP = listTldrRows(config).catch(() => []);
  const manP = listManRows().catch(() => []);

  const tldr = await tldrP;
  rows = tldr.map((r) => ({
    ref: { source: "tldr", name: r.name }, title: r.name, sub: "tldr",
  }));
  refreshResults();

  const man = await manP;
  rows = [
    ...rows,
    ...man.map((r) => ({
      ref: { source: "man", name: r.name, section: r.section },
      title: `${r.name}(${r.section})`,
      sub: r.desc || "man",
    })),
  ];
  rowsReady = true;
  refreshResults();

  // A stale-clipboard prefill that matches nothing just gets in the way —
  // clear it once the full row set proves it bogus (unless the user typed).
  if (prefill && query === prefill && !anyMatch(query)) {
    query = "";
    if (input) input.value = "";
    refreshResults();
  }
}

function anyMatch(q) {
  const needle = q.trim().toLowerCase();
  return rows.some((r) => r.title.toLowerCase().includes(needle) ||
    r.sub.toLowerCase().includes(needle));
}

// Highlighted text reaches the clipboard when Settings → Terminal →
// "Auto-copy terminal selection" is on; accept it only when it plausibly
// names a page. On a remote workspace pbpaste fails and we skip.
async function selectionQuery() {
  try {
    const result = await muxy.exec(["pbpaste"], { timeoutMs: 3000 });
    if (result.exitCode !== 0) return null;
    const text = result.stdout.trim();
    if (!text || text.length > 64) return null;
    if (/\s/.test(text)) return null;
    if (!/^[A-Za-z0-9._+:@()\[\]!$%,-]+$/.test(text)) return null;
    return text;
  } catch {
    return null;
  }
}

// --- list mode ----------------------------------------------------------------

function renderList() {
  mode = "list";
  currentDoc = null;
  clear(root);

  input = h("input", {
    type: "text",
    placeholder: placeholderFor(contentSearch),
    value: query,
    oninput: () => {
      query = input.value;
      selected = 0;
      refreshResults();
    },
    onkeydown: onListKeydown,
  });

  const toggle = h("input", {
    type: "checkbox",
    id: "content-search",
    onchange: () => {
      contentSearch = toggle.checked;
      input.placeholder = placeholderFor(contentSearch);
      selected = 0;
      refreshResults();
      input.focus();
    },
  });
  toggle.checked = contentSearch;

  root.appendChild(h("div", { class: "search-row" },
    input,
    h("label", {
      class: "check",
      for: "content-search",
      title: "Search the text inside pages, not just their names",
    }, toggle, "Search contents")));
  root.appendChild(h("div", { class: "scroll", id: "results" }));
  root.appendChild(
    h("div", { class: "hintbar" },
      h("span", null, h("kbd", null, "↑↓"), " navigate"),
      h("span", null, h("kbd", null, "⏎"), " open"),
      h("span", null, h("kbd", null, "esc"), " close"),
      h("span", { class: "grow" }),
      h("button", {
        type: "button", class: "icon-btn settings-btn", title: "Settings",
        onclick: renderSettingsView,
      }, "⚙")),
  );

  input.focus();
  refreshResults();
}

function renderSettingsView() {
  mode = "settings";
  searchToken += 1;
  clearTimeout(searchTimer);
  clear(root);
  renderSettings(root, {
    getConfig: () => config,
    setConfig: (next) => {
      const reload = next.platform !== config.platform ||
        next.extraPlatforms !== config.extraPlatforms;
      config = next;
      if (reload) {
        rows = [];
        rowsReady = false;
        loadRows();
      }
    },
    onClose: () => renderList(),
  });
}

async function refreshResults() {
  const scroll = document.getElementById("results");
  if (!scroll || mode !== "list") return;
  const q = query.trim();

  searchToken += 1; // cancel any content search still in flight
  clearTimeout(searchTimer);

  if (!q) {
    clear(scroll);
    await renderHome(scroll);
    return;
  }

  if (contentSearch) {
    scheduleContentSearch(scroll, q);
    return;
  }

  const needle = q.toLowerCase();
  const starts = [];
  const contains = [];
  const inSub = [];
  for (const row of rows) {
    const title = row.title.toLowerCase();
    if (title.startsWith(needle)) starts.push(row);
    else if (title.includes(needle)) contains.push(row);
    else if (row.sub.toLowerCase().includes(needle)) inSub.push(row);
    if (starts.length >= MAX_RESULTS) break;
  }
  const matches = [...starts, ...contains, ...inSub].slice(0, MAX_RESULTS);

  clear(scroll);
  matches.forEach((row, i) => scroll.appendChild(resultRow(row, i)));
  if (!matches.length) {
    scroll.appendChild(h("div", { class: "list-note" },
      rowsReady ? "No matches." : "Loading page lists…"));
  }
}

async function renderHome(scroll) {
  const [recents, favorites] = await Promise.all([getRecents(), getFavorites()]);
  if (query.trim()) return; // superseded while loading
  if (favorites.length) {
    scroll.appendChild(h("div", { class: "section-label" }, "Favorites"));
    scroll.appendChild(h("div", { class: "chips" }, favorites.map(chip)));
  }
  if (recents.length) {
    scroll.appendChild(h("div", { class: "section-label" }, "Recents"));
    scroll.appendChild(h("div", { class: "chips" }, recents.map(chip)));
  }
  if (!favorites.length && !recents.length) {
    scroll.appendChild(h("div", { class: "state" },
      h("div", { class: "state-title" }, "Cheatsheets"),
      h("div", null, "Type a command name to look up its tldr or man page."),
    ));
  }
}

function chip(ref) {
  return h("button", {
    type: "button", class: "chip",
    onclick: () => openDoc(ref),
  },
  ref.name,
  ref.section ? h("span", { class: "sec" }, `(${ref.section})`) : null,
  h("span", { class: "sec" }, ref.source));
}

function resultRow(row, index) {
  return h("button", {
    type: "button",
    class: `row${index === selected ? " selected" : ""}`,
    onclick: () => openDoc(row.ref),
  },
  h("span", { class: "row-title" }, row.title),
  h("span", { class: "row-sub" }, row.sub),
  h("span", { class: "badge neutral" }, row.ref.source));
}

function placeholderFor(contents) {
  return contents
    ? "Search inside page text…"
    : "Search for a command…";
}

function contentRow(r) {
  return {
    ref: r.source === "man"
      ? { source: "man", name: r.name, section: r.section }
      : { source: "tldr", name: r.name, platform: r.platform },
    title: r.section ? `${r.name}(${r.section})` : r.name,
    sub: r.desc || r.source,
  };
}

function scheduleContentSearch(scroll, term) {
  const token = searchToken;
  clear(scroll);
  if (term.length < CONTENT_MIN) {
    scroll.appendChild(h("div", { class: "list-note" },
      `Type at least ${CONTENT_MIN} characters to search page contents.`));
    return;
  }
  scroll.appendChild(h("div", { class: "state" }, h("div", { class: "spinner" })));
  searchTimer = setTimeout(() => runContentSearch(scroll, term, token), CONTENT_DEBOUNCE);
}

async function runContentSearch(scroll, term, token) {
  let result;
  try {
    result = await searchContents(term);
  } catch (err) {
    if (token !== searchToken || mode !== "list") return;
    clear(scroll);
    scroll.appendChild(h("div", { class: "list-note" }, `Search failed: ${err?.message ?? err}`));
    return;
  }
  if (token !== searchToken || mode !== "list") return;

  clear(scroll);
  result.rows.slice(0, MAX_RESULTS).forEach((r, i) =>
    scroll.appendChild(resultRow(contentRow(r), i)));
  if (!result.rows.length) {
    scroll.appendChild(h("div", { class: "list-note" }, `No page text contains “${term}”.`));
  } else if (result.rows.length > MAX_RESULTS) {
    scroll.appendChild(h("div", { class: "list-note" },
      `Showing first ${MAX_RESULTS} of ${result.rows.length}.`));
  }
  for (const note of result.notes) {
    scroll.appendChild(h("div", { class: "list-note" }, note));
  }
}

function onListKeydown(e) {
  const rowEls = [...document.querySelectorAll("#results .row")];
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!rowEls.length) return;
    selected = e.key === "ArrowDown"
      ? Math.min(selected + 1, rowEls.length - 1)
      : Math.max(selected - 1, 0);
    rowEls.forEach((r, i) => r.classList.toggle("selected", i === selected));
    rowEls[selected].scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") {
    e.preventDefault();
    rowEls[selected]?.click();
  }
}

// --- reading mode ----------------------------------------------------------------

async function openDoc(ref) {
  mode = "read";
  pushRecent(ref).catch(() => {});
  searchToken += 1;          // drop any queued content search
  clearTimeout(searchTimer);
  clear(root);

  const body = h("div", { class: "read-body" },
    h("div", { class: "state" }, h("div", { class: "spinner" })));
  root.appendChild(readHead(ref));
  root.appendChild(body);

  try {
    const doc = await fetchDoc(ref, config);
    if (mode !== "read") return;
    currentDoc = doc;
    clear(body);
    if (doc.kind === "tldr") {
      body.appendChild(renderTldr(doc.page));
      root.appendChild(
        h("div", { class: "hintbar" },
          h("span", null, h("kbd", null, "1"), "–", h("kbd", null, "9"), " copy example"),
          h("span", null, h("kbd", null, "⌥"), " strip {{placeholders}}")),
      );
    } else if (doc.kind === "man-html") {
      body.appendChild(renderManHtml(doc.html));
    } else {
      body.appendChild(renderManPre(doc.runs));
    }
  } catch (err) {
    if (mode !== "read") return;
    clear(body);
    renderDocError(body, ref, err);
  }
}

function renderDocError(body, ref, err) {
  const noCache = err instanceof SourceError && err.code === "no-cache";
  const other = ref.source === "tldr" ? "man" : "tldr";
  body.appendChild(h("div", { class: "state" },
    h("div", { class: "state-title" },
      noCache ? "tldr cache not initialized" : "Could not load page"),
    h("div", null, err?.message ?? String(err)),
    h("div", { style: "display:flex; gap: var(--s4)" },
      noCache
        ? h("button", {
            type: "button", class: "text-btn primary",
            onclick: async (e) => {
              e.target.disabled = true;
              e.target.textContent = "Updating…";
              try { await updateTldrCache(); openDoc(ref); }
              catch (e2) { e.target.textContent = `Failed: ${e2?.message ?? e2}`; }
            },
          }, "Update now")
        : h("button", {
            type: "button", class: "text-btn",
            onclick: () => openDoc({ source: other, name: ref.name }),
          }, `Try ${other} ›`)),
  ));
}

function readHead(ref) {
  const back = h("button", {
    type: "button", class: "icon-btn", title: "Back to search",
    onclick: () => renderList(),
  }, "‹");

  const star = h("button", {
    type: "button", class: "icon-btn", title: "Favorite",
    onclick: async () => {
      const fav = await toggleFavorite(ref);
      star.textContent = fav ? "★" : "☆";
      star.classList.toggle("active", fav);
    },
  }, "☆");
  isFavorite(ref).then((fav) => {
    star.textContent = fav ? "★" : "☆";
    star.classList.toggle("active", fav);
  });

  const other = ref.source === "tldr" ? "man" : "tldr";
  const otherBtn = h("button", {
    type: "button", class: "text-btn",
    title: `Look up “${ref.name}” in ${other} instead`,
    onclick: () => openDoc({ source: other, name: ref.name }),
  }, `${other} ›`);

  const pin = h("button", {
    type: "button", class: "icon-btn", title: "Pin as tab",
    onclick: async () => {
      try {
        await muxy.tabs.open({
          kind: "extensionWebView",
          extension: {
            id: muxy.extensionID,
            tabType: "sheet",
            data: { ref, presentation: "tab" },
          },
        });
        muxy.lifecycle.close();
      } catch (err) {
        console.warn("pin as tab failed", err);
      }
    },
  }, "▣");

  return h("div", { class: "read-head" },
    back,
    h("span", { class: "title" }, refTitle(ref)),
    h("span", { class: "badge neutral" }, ref.source),
    h("span", { class: "actions" }, star, otherBtn, pin));
}

// --- keyboard: 1–9 copies examples in reading mode --------------------------------

window.addEventListener("keydown", (e) => {
  if (mode !== "read" || currentDoc?.kind !== "tldr") return;
  if (e.metaKey || e.ctrlKey) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  const n = Number(e.key);
  if (n >= 1 && n <= 9) {
    const ex = currentDoc.page.examples[n - 1];
    if (ex) {
      e.preventDefault();
      const btn = root.querySelectorAll(".example .copy-btn")[n - 1];
      copyExample(ex, btn, e.altKey);
    }
  }
});
