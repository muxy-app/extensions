// Popover browser (Flow B): search → results → inline render, plus recents,
// favorites, and settings in the footer.
import "@/popover/popover.css";
import { h, clear } from "@/lib/dom";
import { refTitle } from "@/shared/refs";
import {
  fetchDoc, loadConfig, updateTldrCache, tldrCacheInfo,
  pushRecent, getRecents, getFavorites, toggleFavorite, isFavorite,
  listTldrRows, listManRows, searchContents, CONTENT_MIN, SourceError,
} from "@/shared/sources";
import { renderSettings } from "@/shared/settings";
import { renderTldr, renderManHtml, renderManPre } from "@/shared/render";

const LIST_SIZE = { w: 380, h: 520 };
const READ_SIZE = { w: 380, h: 560 };
const MAX_RESULTS = 200;
// Content search shells out to grep over the whole man tree, so it waits for a
// pause in typing rather than firing per keystroke.
const CONTENT_DEBOUNCE = 350;

const root = document.getElementById("root");
let config = null;
let allRows = null;      // [{ref, title, sub}] — loaded lazily on first query
let rowsLoading = null;
let selected = 0;
let query = "";
let searchToken = 0;
let contentSearch = false; // "Search contents" — session-local, defaults off
let searchTimer = null;

init();

async function init() {
  config = await loadConfig();
  contentSearch = !!config.contentSearchDefault;
  renderList();
  muxy.onFocus?.((focused) => {
    if (focused) root.querySelector("input")?.focus();
  });
}

// --- list mode ----------------------------------------------------------------

async function renderList() {
  clear(root);
  muxy.popover.resize(LIST_SIZE.w, LIST_SIZE.h).catch(() => {});

  const input = h("input", {
    type: "text",
    placeholder: placeholderFor(contentSearch),
    // The popover has a footer where the lookup modal has a hintbar, so the
    // man-section trick lives here rather than in the placeholder.
    title: "Type a command name. “open(2” narrows to a man section.",
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

  const scroll = h("div", { class: "scroll", id: "results" });
  root.appendChild(scroll);
  root.appendChild(footer());

  input.focus();
  refreshResults();
}

async function refreshResults() {
  const scroll = document.getElementById("results");
  if (!scroll) return;
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

  const rows = await ensureRows(scroll);
  if (query.trim() !== q) return; // superseded while loading
  const needle = q.toLowerCase();
  const matches = [];
  for (const row of rows) {
    if (row.title.toLowerCase().includes(needle) ||
        row.sub.toLowerCase().includes(needle)) {
      matches.push(row);
      if (matches.length >= MAX_RESULTS + 1) break;
    }
  }
  clear(scroll);
  matches.slice(0, MAX_RESULTS).forEach((row, i) => scroll.appendChild(resultRow(row, i)));
  if (!matches.length) {
    scroll.appendChild(h("div", { class: "list-note" }, "No matches."));
  } else if (matches.length > MAX_RESULTS) {
    scroll.appendChild(h("div", { class: "list-note" }, `Showing first ${MAX_RESULTS} — keep typing.`));
  }
}

async function renderHome(scroll) {
  const [recents, favorites] = await Promise.all([getRecents(), getFavorites()]);
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
      h("div", null, "Type a command name to browse tldr and man pages. " +
        "Add a section like “open(2” to narrow to a man page."),
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
  const el = h("button", {
    type: "button",
    class: `row${index === selected ? " selected" : ""}`,
    "data-index": String(index),
    onclick: () => openDoc(row.ref),
  },
  h("span", { class: "row-title" }, row.title),
  h("span", { class: "row-sub" }, row.sub),
  h("span", { class: "badge neutral" }, row.ref.source));
  return el;
}

async function ensureRows(scroll) {
  if (allRows) return allRows;
  if (!rowsLoading) {
    clear(scroll);
    scroll.appendChild(h("div", { class: "state" }, h("div", { class: "spinner" })));
    rowsLoading = (async () => {
      const [tldr, man] = await Promise.all([
        listTldrRows(config).catch(() => []),
        listManRows().catch(() => []),
      ]);
      const rows = [];
      for (const r of tldr) {
        rows.push({ ref: { source: "tldr", name: r.name }, title: r.name, sub: "tldr" });
      }
      for (const r of man) {
        rows.push({
          ref: { source: "man", name: r.name, section: r.section },
          title: `${r.name}(${r.section})`,
          sub: r.desc || "man",
        });
      }
      allRows = rows;
      return rows;
    })();
  }
  return rowsLoading;
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
    if (token !== searchToken) return;
    clear(scroll);
    scroll.appendChild(h("div", { class: "list-note" }, `Search failed: ${err?.message ?? err}`));
    return;
  }
  if (token !== searchToken) return;

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
  const rows = [...document.querySelectorAll("#results .row")];
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!rows.length) return;
    selected = e.key === "ArrowDown"
      ? Math.min(selected + 1, rows.length - 1)
      : Math.max(selected - 1, 0);
    rows.forEach((r, i) => r.classList.toggle("selected", i === selected));
    rows[selected].scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") {
    e.preventDefault();
    rows[selected]?.click();
  }
}

// --- reading mode ----------------------------------------------------------------

async function openDoc(ref) {
  pushRecent(ref).catch(() => {});
  searchToken += 1;          // drop any queued content search
  clearTimeout(searchTimer);
  clear(root);
  muxy.popover.resize(READ_SIZE.w, READ_SIZE.h).catch(() => {});

  const body = h("div", { class: "read-body" },
    h("div", { class: "state" }, h("div", { class: "spinner" })));
  root.appendChild(readHead(ref));
  root.appendChild(body);

  try {
    const doc = await fetchDoc(ref, config);
    clear(body);
    if (doc.kind === "tldr") body.appendChild(renderTldr(doc.page));
    else if (doc.kind === "man-html") body.appendChild(renderManHtml(doc.html));
    else body.appendChild(renderManPre(doc.runs));
  } catch (err) {
    clear(body);
    const noCache = err instanceof SourceError && err.code === "no-cache";
    body.appendChild(h("div", { class: "state" },
      h("div", { class: "state-title" }, noCache ? "tldr cache not initialized" : "Could not load"),
      h("div", null, err?.message ?? String(err)),
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
        : null,
    ));
  }
}

function readHead(ref) {
  const back = h("button", {
    type: "button", class: "icon-btn", title: "Back",
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

  const pin = h("button", {
    type: "button", class: "icon-btn", title: "Open as tab",
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
        muxy.popover.close().catch(() => {});
      } catch (err) {
        console.warn("open as tab failed", err);
      }
    },
  }, "▣");

  return h("div", { class: "read-head" },
    back,
    h("span", { class: "title" }, refTitle(ref)),
    h("span", { class: "badge neutral" }, ref.source),
    h("span", { class: "actions" }, star, pin));
}

// --- footer / settings --------------------------------------------------------------

// The platform / source-order / cache controls that used to crowd this footer
// now live in the settings view, which the lookup modal shares.
function footer() {
  const cacheInfo = h("div", { class: "cache-info" });
  tldrCacheInfo().then((info) => { if (info) cacheInfo.textContent = info; });

  return h("div", { class: "footer" },
    cacheInfo,
    h("button", {
      type: "button", class: "icon-btn settings-btn", title: "Settings",
      onclick: renderSettingsView,
    }, "⚙"));
}

function renderSettingsView() {
  searchToken += 1;
  clearTimeout(searchTimer);
  clear(root);
  renderSettings(root, {
    getConfig: () => config,
    setConfig: (next) => {
      config = next;
      allRows = null;       // platform / extraPlatforms change the row set
      rowsLoading = null;
    },
    onClose: () => renderList(),
  });
}

