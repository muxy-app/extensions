// Settings view, shared by the popover and the lookup modal. Renders into a
// container the caller already owns; every change writes through immediately
// (there is no Save button) via saveConfig.
//
// Only settings a page can honour itself live here. Surface visibility and a
// custom hotkey were tried and removed: both need the background host to
// replay them at launch, and it has neither muxy.storage nor muxy.shortcuts
// (see background.js). The ⌘⌃K binding is a manifest defaultShortcut, which
// users rebind through Muxy's own Keyboard Shortcuts settings.
import { h, clear } from "@/lib/dom";
import { saveConfig, updateTldrCache, tldrCacheInfo } from "@/shared/sources";

const PLATFORMS = ["osx", "linux", "windows", "common"];

export function renderSettings(container, ctx) {
  const { getConfig, setConfig, onClose } = ctx;

  const draw = () => {
    const config = getConfig();
    clear(container);

    const noteEl = h("div", { class: "set-note" });

    // --- lookup behaviour ---
    const contentsBox = h("input", {
      type: "checkbox",
      onchange: () => commit({ contentSearchDefault: contentsBox.checked }),
    });
    contentsBox.checked = !!config.contentSearchDefault;

    // --- tldr (absorbed from the popover footer) ---
    const platformSel = h("select", {
      onchange: () => commit({ platform: platformSel.value }),
    }, PLATFORMS.map((p) =>
      h("option", { value: p, ...(p === config.platform ? { selected: "" } : {}) }, p)));

    const orderBtn = h("button", {
      type: "button", class: "mini-btn",
      title: "Which source is tried first",
      onclick: () => commit({
        sourceOrder: config.sourceOrder[0] === "tldr" ? ["man", "tldr"] : ["tldr", "man"],
      }),
    }, config.sourceOrder.join(" → "));

    const allBox = h("input", {
      type: "checkbox",
      onchange: () => commit({ extraPlatforms: allBox.checked }),
    });
    allBox.checked = !!config.extraPlatforms;

    const cacheInfo = h("div", { class: "set-detail" }, "Checking cache…");
    tldrCacheInfo().then((info) => {
      cacheInfo.textContent = info || "No tldr cache — pages come from GitHub.";
    });

    const updateBtn = h("button", {
      type: "button", class: "mini-btn",
      onclick: async () => {
        updateBtn.disabled = true;
        updateBtn.textContent = "Updating…";
        try {
          await updateTldrCache();
          updateBtn.textContent = "Updated ✓";
          tldrCacheInfo().then((info) => { if (info) cacheInfo.textContent = info; });
        } catch (err) {
          updateBtn.textContent = "Update failed";
          note(err?.message ?? String(err));
        } finally {
          updateBtn.disabled = false;
        }
      },
    }, "Update cache");

    container.appendChild(h("div", { class: "settings" },
      h("div", { class: "set-head" },
        h("button", {
          type: "button", class: "icon-btn", title: "Back", onclick: onClose,
        }, "‹"),
        h("span", { class: "set-title" }, "Settings")),

      h("div", { class: "set-body" },
      section("Lookup", [
        h("label", { class: "set-row set-check" },
          contentsBox,
          h("span", null,
            h("span", { class: "set-item-label" }, "Search contents by default"),
            h("span", { class: "set-detail" },
              "Start with the checkbox ticked, searching page text instead of names"))),
      ]),

      section("tldr pages", [
        h("div", { class: "set-row" },
          h("span", { class: "set-label" }, "Platform"), platformSel),
        h("div", { class: "set-row" },
          h("span", { class: "set-label" }, "Source order"), orderBtn),
        h("label", { class: "set-row set-check" },
          allBox,
          h("span", { class: "set-item-label" }, "List pages from all platforms")),
        h("div", { class: "set-row" },
          h("span", { class: "set-label" }, "Cache"), updateBtn),
        cacheInfo,
      ]),

      section("Keyboard", [
        h("div", { class: "set-detail" },
          "⌘⌃K opens the lookup modal. Rebind or clear it under Muxy " +
          "Settings → Keyboard Shortcuts → App Shortcuts."),
      ]),
      noteEl)));

    function note(text) {
      noteEl.textContent = text;
    }
  };

  async function commit(patch) {
    const next = { ...getConfig(), ...patch };
    setConfig(next);
    draw();
    await saveConfig(next);
  }

  draw();
}

function section(title, children) {
  return h("div", { class: "set-section" },
    h("div", { class: "section-label" }, title),
    ...children);
}
