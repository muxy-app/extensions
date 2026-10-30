// DOM renderers for the three doc kinds. Shared by the viewer (modal + tab)
// and the popover's inline reading mode.
import { h, clear } from "@/lib/dom";
import { commandText } from "@/shared/parse";
import { copyText } from "@/lib/clipboard";

// --- tldr ------------------------------------------------------------------

// doc: output of parseTldrPage. Returns an element; copy buttons are wired.
export function renderTldr(doc) {
  const root = h("div", { class: "tldr" });

  if (doc.description.length) {
    root.appendChild(
      h("div", { class: "tldr-desc" },
        doc.description.map((line) => h("p", null, inlineNodes(line)))),
    );
  }
  if (doc.moreInfo) {
    root.appendChild(
      h("p", { class: "tldr-more" }, "More information: ",
        h("a", { href: doc.moreInfo, target: "_blank", rel: "noreferrer" }, doc.moreInfo)),
    );
  }

  doc.examples.forEach((ex, i) => {
    root.appendChild(renderExample(ex, i));
  });

  if (!doc.examples.length && !doc.description.length) {
    root.appendChild(h("p", { class: "empty-note" }, "This page has no content."));
  }
  return root;
}

function renderExample(ex, index) {
  const btn = h("button", {
    type: "button",
    class: "copy-btn",
    title: "Copy (⌥-click to strip {{placeholders}})",
    onclick: (e) => copyExample(ex, btn, e.altKey),
  }, copyIcon(), h("span", { class: "copy-key" }, index < 9 ? String(index + 1) : ""));

  return h("div", { class: "example", "data-index": String(index) },
    h("div", { class: "example-label" }, inlineNodes(ex.label)),
    h("div", { class: "example-cmd" },
      h("code", null, ex.cmd.map((tok) =>
        tok.t === "ph"
          ? h("span", { class: "ph" }, tok.v)
          : h("span", { class: "lit" }, tok.v))),
      btn),
  );
}

export async function copyExample(ex, button, stripPlaceholders) {
  const ok = await copyText(commandText(ex.cmd, !stripPlaceholders));
  if (button) flashCopied(button, ok);
  return ok;
}

function flashCopied(button, ok) {
  button.classList.add(ok ? "copied" : "copy-failed");
  const old = button.firstChild;
  const mark = h("span", { class: "copy-mark" }, ok ? "✓" : "✗");
  button.replaceChild(mark, old);
  setTimeout(() => {
    button.classList.remove("copied", "copy-failed");
    button.replaceChild(old, mark);
  }, 900);
}

function inlineNodes(tokens) {
  return tokens.map((tok) => {
    if (tok.t === "code") return h("code", { class: "inline-code" }, tok.v);
    if (tok.t === "link") {
      return h("a", { href: tok.v, target: "_blank", rel: "noreferrer" }, tok.v);
    }
    return document.createTextNode(tok.v);
  });
}

function copyIcon() {
  const span = h("span", { class: "copy-icon" });
  span.innerHTML =
    '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
    'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/>' +
    '<path d="M10.5 3.5v-1a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1"/></svg>';
  return span;
}

// --- man -------------------------------------------------------------------

// html: ALREADY-SANITIZED fragment from sanitizeHtml().
export function renderManHtml(sanitizedHtml) {
  const root = h("div", { class: "man" });
  root.innerHTML = sanitizedHtml;
  return root;
}

// runs: output of stripOverstrike.
export function renderManPre(runs) {
  const pre = h("pre", { class: "man-pre" });
  const CHUNK = 2000;
  for (let i = 0; i < runs.length; i += CHUNK) {
    for (const run of runs.slice(i, i + CHUNK)) {
      if (!run.bold && !run.underline) {
        pre.appendChild(document.createTextNode(run.text));
      } else {
        const cls = [run.bold && "b", run.underline && "u"].filter(Boolean).join(" ");
        pre.appendChild(h("span", { class: cls }, run.text));
      }
    }
  }
  return pre;
}

// Section outline for a man html doc (tab presentation): [{id, title}].
export function manOutline(container) {
  return [...container.querySelectorAll("h2[id], h1[id]")].map((el) => ({
    id: el.id,
    title: el.textContent.replace(/\s+/g, " ").trim(),
  }));
}

export { h, clear };
