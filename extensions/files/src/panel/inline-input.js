// The name field for Rename and New File / New Folder. It is an overlay on the
// list canvas rather than part of a row, so virtual-list re-renders (git
// status, file events) never touch the element the user is typing in.

import { h } from "@/shared/dom";

export class InlineInput {
  /**
   * @param {HTMLElement} canvas
   * @param {{ commit: (value: string) => Promise<string | null>, cancel: () => void }} handlers
   *   `commit` resolves to an error message to show, or null when done.
   */
  constructor(canvas, handlers) {
    this.handlers = handlers;
    this.busy = false;
    this.done = false;
    this.input = h("input", {
      class: "inline-input",
      type: "text",
      spellcheck: "false",
      autocomplete: "off",
      autocorrect: "off",
      autocapitalize: "off",
      "aria-label": "Name",
    });
    this.message = h("div", { class: "inline-input-error", role: "alert", hidden: true });
    this.root = h("div", { class: "inline-input-wrap" }, this.input, this.message);
    canvas.appendChild(this.root);

    this.input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        void this.commit(false);
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.cancel();
      }
    });
    this.input.addEventListener("input", () => this.showError(null));
    this.input.addEventListener("blur", () => {
      if (!this.done && !this.busy) void this.commit(true);
    });
    for (const type of ["pointerdown", "click", "dblclick", "contextmenu"]) {
      this.root.addEventListener(type, (event) => event.stopPropagation());
    }
  }

  /** Shows the field on row `index`, selecting the name up to its extension. */
  show(index, depth, rowHeight, value, selectEnd = value.length) {
    this.place(index, depth, rowHeight);
    this.input.value = value;
    requestAnimationFrame(() => {
      if (this.done) return;
      this.input.focus({ preventScroll: true });
      this.input.setSelectionRange(0, selectEnd);
    });
  }

  place(index, depth, rowHeight) {
    this.root.style.transform = `translateY(${index * rowHeight}px)`;
    this.root.style.setProperty("--depth", String(depth));
  }

  showError(message) {
    this.message.hidden = !message;
    this.message.textContent = message ?? "";
    this.input.classList.toggle("inline-input-invalid", Boolean(message));
  }

  async commit(fromBlur) {
    if (this.busy || this.done) return;
    const value = this.input.value.trim();
    this.busy = true;
    let error = null;
    try {
      error = await this.handlers.commit(value);
    } finally {
      this.busy = false;
    }
    if (this.done) return;
    if (error && !fromBlur) {
      this.showError(error);
      this.input.focus({ preventScroll: true });
      return;
    }
    if (error) this.cancel();
  }

  cancel() {
    if (this.done) return;
    this.handlers.cancel();
  }

  get focused() {
    return document.activeElement === this.input;
  }

  remove() {
    this.done = true;
    this.root.remove();
  }
}
