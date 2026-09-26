// Viewer page — one page, two presentations: webview modal (palette lookup)
// and pinned tab (tabType 'sheet'). muxy.data = { ref, presentation }.
import "@/viewer/viewer.css";
import { h, clear } from "@/lib/dom";
import { refTitle } from "@/shared/refs";
import {
  fetchDoc, loadConfig, updateTldrCache, pushRecent,
  toggleFavorite, isFavorite, SourceError,
} from "@/shared/sources";
import { renderTldr, renderManHtml, renderManPre, manOutline, copyExample } from "@/shared/render";

const root = document.getElementById("root");
const presentation = muxy.data?.presentation === "tab" ? "tab" : "modal";
document.body.classList.add(`presentation-${presentation}`);

let currentRef = null;
let currentDoc = null;
let favorite = false;

init(muxy.data?.ref);
muxy.onDataChange?.((data) => {
  if (data?.ref) init(data.ref);
});

async function init(ref) {
  if (!ref) {
    renderState({ title: "No page requested", detail: "Open a page from the palette or popover." });
    return;
  }
  await load(ref);
}

async function load(ref) {
  currentRef = ref;
  renderState({ spinner: true, title: refTitle(ref) });
  if (presentation === "tab") {
    muxy.tabs.setTitle?.(refTitle(ref)).catch?.(() => {});
  }
  try {
    const config = await loadConfig();
    const [doc, fav] = await Promise.all([fetchDoc(ref, config), isFavorite(ref)]);
    currentDoc = doc;
    favorite = fav;
    renderDoc(doc);
    // The background can't reach storage, so the viewer records the recent.
    pushRecent(ref).catch(() => {});
  } catch (err) {
    currentDoc = null;
    renderError(err, ref);
  }
}

// --- rendering ---------------------------------------------------------------

function renderDoc(doc) {
  clear(root);
  root.appendChild(header(doc));

  const body = h("div", { class: "viewer-body" });
  const content = h("div", { class: "content" });

  if (doc.kind === "tldr") {
    content.appendChild(renderTldr(doc.page));
  } else if (doc.kind === "man-html") {
    const man = renderManHtml(doc.html);
    wireManExtras(man, body, content);
    content.appendChild(man);
  } else {
    content.appendChild(renderManPre(doc.runs));
  }
  body.appendChild(content);
  root.appendChild(body);

  if (doc.kind === "tldr" && doc.page.examples.length) {
    root.appendChild(
      h("div", { class: "hint" },
        h("span", null, h("kbd", null, "1"), "–", h("kbd", null, "9"), " copy example"),
        h("span", null, h("kbd", null, "⌥"), " strip ", h("span", { class: "mono" }, "{{placeholders}}")),
      ),
    );
  }
}

function header(doc) {
  const title = refTitle(currentRef);
  const badge = h("span", { class: "badge" },
    doc.kind === "tldr" ? (doc.via === "http" ? "tldr · web" : "tldr") : "man");

  const actions = h("span", { class: "actions" },
    starButton(),
    otherSourceButton(),
    presentation === "modal" ? openAsTabButton() : null,
  );

  return presentation === "tab"
    ? h("header", { class: "topbar" }, h("span", { class: "title" }, title), badge, actions)
    : h("header", { class: "modal-head" }, h("span", { class: "title" }, title), badge, actions);
}

function starButton() {
  const btn = h("button", {
    type: "button",
    class: `icon-btn${favorite ? " active" : ""}`,
    title: favorite ? "Remove favorite" : "Add favorite",
    onclick: async () => {
      favorite = await toggleFavorite(currentRef);
      btn.classList.toggle("active", favorite);
      btn.textContent = favorite ? "★" : "☆";
    },
  }, favorite ? "★" : "☆");
  return btn;
}

function otherSourceButton() {
  const other = currentRef.source === "tldr" ? "man" : "tldr";
  return h("button", {
    type: "button",
    class: "text-btn",
    title: `Look up “${currentRef.name}” in ${other} instead`,
    onclick: () => load({ source: other, name: currentRef.name }),
  }, `${other} ›`);
}

function openAsTabButton() {
  return h("button", {
    type: "button",
    class: "icon-btn",
    title: "Pin as tab",
    onclick: async () => {
      try {
        await muxy.tabs.open({
          kind: "extensionWebView",
          extension: {
            id: muxy.extensionID,
            tabType: "sheet",
            data: { ref: currentRef, presentation: "tab" },
          },
        });
        muxy.lifecycle.close();
      } catch (err) {
        console.warn("pin as tab failed", err);
      }
    },
  }, pinIcon());
}

function wireManExtras(man, body, content) {
  // Cross-references: click tar(1) → load that page.
  man.addEventListener("click", (e) => {
    const xr = e.target.closest?.(".Xr");
    if (!xr) return;
    const m = xr.textContent.trim().match(/^([^\s()]+)\((\w+)\)$/);
    if (m) {
      e.preventDefault();
      load({ source: "man", name: m[1], section: m[2] });
    }
  });

  // Section outline on the wide (tab) presentation.
  if (presentation === "tab") {
    const sections = manOutline(man);
    if (sections.length > 1) {
      body.classList.add("has-outline");
      body.appendChild(
        h("nav", { class: "outline" },
          sections.map((s) =>
            h("a", {
              href: `#${s.id}`,
              onclick: (e) => {
                e.preventDefault();
                content.querySelector(`#${CSS.escape(s.id)}`)?.scrollIntoView();
              },
            }, s.title))),
      );
    }
  }
}

// --- error states --------------------------------------------------------------

function renderError(err, ref) {
  if (err instanceof SourceError && err.code === "no-cache") {
    renderState({
      title: "tldr cache not initialized",
      detail: "Download the tldr pages once to enable offline lookups.",
      actions: [updateButton(ref)],
    });
    return;
  }
  const other = ref.source === "tldr" ? "man" : "tldr";
  renderState({
    title: err instanceof SourceError && err.code === "not-found"
      ? `No ${ref.source} page found`
      : "Could not load page",
    detail: err?.message ?? String(err),
    actions: [
      h("button", {
        type: "button", class: "text-btn",
        onclick: () => load({ source: other, name: ref.name }),
      }, `Try ${other} ›`),
      h("button", {
        type: "button", class: "text-btn",
        onclick: () => load(ref),
      }, "Retry"),
    ],
  });
}

function updateButton(ref) {
  const btn = h("button", {
    type: "button",
    class: "text-btn primary",
    onclick: async () => {
      btn.disabled = true;
      btn.textContent = "Updating…";
      try {
        await updateTldrCache();
        await load(ref);
      } catch (err) {
        renderState({ title: "Update failed", detail: err?.message ?? String(err),
          actions: [updateButton(ref)] });
      }
    },
  }, "Update now");
  return btn;
}

function renderState({ spinner, title, detail, actions }) {
  clear(root);
  if (currentRef) root.appendChild(headerBare());
  root.appendChild(
    h("div", { class: "viewer-body" },
      h("div", { class: "content" },
        h("div", { class: "state" },
          spinner ? h("div", { class: "spinner" }) : null,
          title ? h("div", { class: "state-title" }, title) : null,
          detail ? h("div", null, detail) : null,
          actions?.length ? h("div", { style: "display:flex; gap: var(--s4)" }, actions) : null,
        ))),
  );
}

function headerBare() {
  const title = refTitle(currentRef);
  return presentation === "tab"
    ? h("header", { class: "topbar" }, h("span", { class: "title" }, title))
    : h("header", { class: "modal-head" }, h("span", { class: "title" }, title));
}

// --- keyboard -------------------------------------------------------------------

window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  const n = Number(e.key);
  if (n >= 1 && n <= 9 && currentDoc?.kind === "tldr") {
    const ex = currentDoc.page.examples[n - 1];
    if (ex) {
      e.preventDefault();
      const btn = root.querySelector(`.example[data-index="${n - 1}"] .copy-btn`);
      copyExample(ex, btn, e.altKey);
    }
  }
});

function pinIcon() {
  const span = h("span", null);
  span.innerHTML =
    '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
    'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="2.5" y="2.5" width="11" height="11" rx="2"/>' +
    '<path d="M2.5 6h11M6 6v7.5"/></svg>';
  return span;
}
