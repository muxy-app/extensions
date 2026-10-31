import { h, setText } from "@/shared/dom";
import { icon } from "@/shared/icons";
import { openMenuBelow } from "@/shared/menu";
import { readString, removeKey, writeString } from "@/shared/prefs";
import { commit, commitPlan, undoLastCommit } from "@/panel/ops/commit";

const MAX_LINES = 8;
const DRAFT_PREFIX = "muxy.git.draft:";

export class Composer {
  constructor(ctl) {
    this.ctl = ctl;
    this.root = null;
    this.saveTimer = null;
    this.input = h("textarea", {
      class: "field composer-input",
      rows: 1,
      placeholder: "Message (⌘↵ to commit)",
      spellcheck: "true",
      "aria-label": "Commit message",
      oninput: () => this.onInput(),
      onkeydown: (event) => this.onKey(event),
    });
    this.label = h("span", { class: "btn-label" }, "Commit");
    this.primary = h("button", { type: "button", class: "btn btn-primary", onclick: () => this.commit({}) }, icon("check", 13), this.label);
    this.more = h("button", { type: "button", class: "btn btn-primary", title: "More commit actions", "aria-label": "More commit actions", onclick: () => this.openMenu() }, icon("chevronDown", 13));
    this.el = h("div", { class: "composer" }, this.input, h("div", { class: "split" }, this.primary, this.more));
  }

  message() {
    return this.input.value.trim();
  }

  setMessage(text) {
    this.input.value = text;
    this.onInput();
  }

  clear() {
    this.input.value = "";
    this.resize();
    if (this.root) removeKey(DRAFT_PREFIX + this.root);
    this.sync();
  }

  focus() {
    this.input.focus();
  }

  setRoot(root) {
    if (root === this.root) return;
    this.flush();
    this.root = root;
    this.input.value = root ? readString(DRAFT_PREFIX + root, "") : "";
    this.resize();
    this.sync();
  }

  onInput() {
    this.resize();
    this.sync();
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.root) return;
    if (this.input.value.trim()) writeString(DRAFT_PREFIX + this.root, this.input.value);
    else removeKey(DRAFT_PREFIX + this.root);
  }

  resize() {
    const style = getComputedStyle(this.input);
    const line = parseFloat(style.lineHeight) || 17;
    const chrome = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + 2;
    this.input.style.height = "auto";
    this.input.style.height = `${Math.min(this.input.scrollHeight, line * MAX_LINES + chrome)}px`;
  }

  onKey(event) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void this.commit({ andPush: event.shiftKey });
    }
  }

  commit(opts) {
    return commit(this.ctl, this, opts);
  }

  sync() {
    const { status, op, busy } = this.ctl.state;
    const plan = commitPlan(status);
    const merging = op === "merge" && !status?.conflicts.length;
    setText(this.label, merging ? "Commit Merge" : plan.kind === "all" ? "Commit All" : "Commit");
    this.primary.title = plan.kind === "all" ? `Stage all ${plan.count} changes and commit` : plan.kind === "staged" ? `Commit ${plan.count} staged change${plan.count === 1 ? "" : "s"}` : "Nothing to commit";
    const disabled = busy > 0 || !this.message() || (plan.kind === "none" && !merging) || !!status?.conflicts.length;
    if (this.primary.disabled !== disabled) this.primary.disabled = disabled;
    this.more.classList.toggle("btn-primary", !disabled);
    if (this.more.disabled !== busy > 0) this.more.disabled = busy > 0;
  }

  openMenu() {
    const { status } = this.ctl.state;
    const plan = commitPlan(status);
    const hasMessage = !!this.message();
    const canCommit = hasMessage && plan.kind !== "none";
    openMenuBelow(
      this.more,
      [
        { label: "Commit & Push", hint: "⇧⌘↵", disabled: !canCommit, run: () => void this.commit({ andPush: true }) },
        status?.staged.length && status?.unstaged.length ? { label: "Commit All", disabled: !hasMessage, run: () => void this.commit({ all: true }) } : null,
        "-",
        { label: hasMessage ? "Amend Last Commit" : "Amend Last Commit (keep message)", run: () => void this.commit({ amend: true }) },
        { label: "Undo Last Commit", run: () => void undoLastCommit(this.ctl, this) },
      ],
      "end",
    );
  }
}
