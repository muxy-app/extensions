// Background script — hosts only the tldr keyword-search picker (palette
// command "search"). The ⌘⌃K lookup is a native openModal command action
// rendering lookup/index.html, with no background involvement.
//
// Host limits, verified against dist/logs/output.log rather than the docs —
// the published API reference overstates what this context has:
//
//   verb 'storage.get' is not available in background context
//   verb 'shortcuts.register' is not available in background context
//   subscribe command.<id> failed: event not declared in manifest
//
// So background has NO muxy.storage and NO muxy.shortcuts, and can only
// subscribe to command.<id> for ids declared in manifest `commands`. It does
// have exec, events, modal.open and statusbar.set. Settings therefore live
// entirely in the webview pages, which have the full bridge; nothing here may
// be load-bearing for a user-visible feature.
//
// Also: items(emit) producers are never invoked and large modal payloads kill
// the socket, so pickers driven from here must stay tiny (initial items +
// ≤500-row onQuery responses) and open pages as tabs.
import { refToId, refFromId } from "./src/shared/refs.js";
import { parseTldrSearch } from "./src/shared/parse.js";

let tldrOk = false;

muxy.events.subscribe("command.search", () => {
  try {
    openSearch();
  } catch (err) {
    console.warn("cheatsheets search:", err?.message ?? err);
  }
});

function openSearch() {
  // Trigger the tldr consent (if still pending) BEFORE the modal opens —
  // onQuery execs would otherwise block behind the picker.
  if (!tldrOk) {
    try {
      const probe = muxy.exec(["tldr", "--version"], { timeoutMs: 10000 });
      tldrOk = probe.exitCode === 0;
    } catch (err) {
      console.warn("tldr probe failed:", err?.message ?? err);
    }
  }

  muxy.modal.open({
    placeholder: "Search tldr pages by keyword…",
    emptyLabel: tldrOk
      ? "Type a keyword to search tldr pages."
      : "Keyword search needs the tldr CLI (brew install tlrc).",
    noMatchLabel: "No tldr pages match.",
    items: [],
    onQuery(query) {
      const term = query.trim();
      if (!term || !tldrOk) return [];
      try {
        const result = muxy.exec(["tldr", "--search", term, "--quiet", "--offline"],
          { timeoutMs: 10000 });
        if (result.exitCode !== 0) return [];
        return parseTldrSearch(result.stdout).slice(0, 500).map((hit) => ({
          id: refToId({ source: "tldr", name: hit.name, platform: hit.platform }),
          title: clip(hit.name, 200),
          // Embeds the query so Muxy's native substring filter (which runs on
          // top of onQuery results) never hides keyword-only matches.
          subtitle: clip(`${query} · ${hit.lang} · ${hit.platform}`, 200),
        }));
      } catch (err) {
        console.warn("tldr --search failed:", err?.message ?? err);
        return [];
      }
    },
    onSelect(row) {
      if (!row) return;
      const ref = refFromId(row.id);
      if (!ref) return;
      // One reused reader tab; the viewer page records the recent itself.
      muxy.tabs.open({
        kind: "extensionWebView",
        extension: {
          id: muxy.extensionID,
          tabType: "sheet",
          singleton: true,
          data: { ref, presentation: "tab" },
        },
      });
    },
  });
}

function clip(text, max) {
  const t = text.replace(/[\x00-\x1f\x7f]/g, " ");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

console.log("cheatsheets background ready (search command only)");
