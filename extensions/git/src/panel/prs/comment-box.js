import { h, setText } from "@/shared/dom";
import { icon } from "@/shared/icons";
import { alertError } from "@/shared/actions";
import { forgeFor } from "@/core/forge";

const MAX_LINES = 12;

export class CommentBox {
  constructor(ctl, { onPosted }) {
    this.ctl = ctl;
    this.onPosted = onPosted;
    this.number = null;
    this.drafts = new Map();
    this.busy = false;
    this.input = h("textarea", {
      class: "field comment-input",
      rows: 3,
      placeholder: "Leave a comment (Markdown supported)",
      oninput: () => this.onInput(),
      onkeydown: (event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          void this.post();
        }
      },
    });
    this.label = h("span", { class: "btn-label" }, "Comment");
    this.submit = h("button", { type: "button", class: "btn btn-primary", onclick: () => void this.post() }, icon("comment", 13), this.label);
    this.el = h(
      "div",
      { class: "comment-box" },
      h("div", { class: "prd-section-title" }, "Add a comment"),
      this.input,
      h("div", { class: "comment-actions" }, h("span", { class: "comment-hint" }, "⌘↵ to post"), this.submit),
    );
    this.sync();
  }

  setPr(number) {
    if (number === this.number) return;
    if (this.number !== null) this.drafts.set(this.number, this.input.value);
    this.number = number;
    this.input.value = this.drafts.get(number) ?? "";
    this.resize();
    this.sync();
  }

  onInput() {
    this.resize();
    this.sync();
  }

  resize() {
    const line = parseFloat(getComputedStyle(this.input).lineHeight) || 17;
    this.input.style.height = "auto";
    this.input.style.height = `${Math.min(Math.max(this.input.scrollHeight, line * 3 + 14), line * MAX_LINES + 14)}px`;
  }

  sync() {
    this.submit.disabled = this.busy || !this.input.value.trim();
    this.input.disabled = this.busy;
    setText(this.label, this.busy ? "Posting…" : "Comment");
  }

  async post() {
    const body = this.input.value.trim();
    const number = this.number;
    if (!body || this.busy || number === null) return;
    this.busy = true;
    this.sync();
    try {
      const forge = await forgeFor(this.ctl.root);
      await forge.api.comment(number, body);
      this.drafts.delete(number);
      if (this.number === number) this.input.value = "";
      this.onPosted(number, body);
    } catch (err) {
      await alertError("Couldn't post the comment", err);
    }
    this.busy = false;
    this.resize();
    this.sync();
    this.input.focus();
  }
}
