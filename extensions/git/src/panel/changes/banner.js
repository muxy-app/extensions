import { h, setText, toggle } from "@/shared/dom";
import { icon } from "@/shared/icons";
import { abortOperation, continueOperation } from "@/panel/ops/commit";

const VERB = { merge: "Merging", rebase: "Rebasing", "cherry-pick": "Cherry-picking", revert: "Reverting" };

export class OperationBanner {
  constructor(ctl, composer) {
    this.ctl = ctl;
    this.title = h("span", { class: "banner-title" });
    this.detail = h("span", { class: "banner-detail" });
    this.continue = h("button", { type: "button", class: "btn", onclick: () => void continueOperation(ctl, composer) }, "Continue");
    this.el = h(
      "div",
      { class: "banner", hidden: true },
      h("span", { class: "banner-icon" }, icon("warning", 14)),
      h("span", { class: "banner-text" }, this.title, this.detail),
      h("button", { type: "button", class: "btn", onclick: () => void abortOperation(ctl, composer) }, "Abort"),
      this.continue,
    );
  }

  update(state) {
    const op = state.op;
    toggle(this.el, !op);
    if (!op) return;
    const conflicts = state.status?.conflicts.length ?? 0;
    setText(this.title, `${VERB[op] ?? "Operation"} in progress`);
    setText(this.detail, conflicts ? `${conflicts} conflict${conflicts === 1 ? "" : "s"} to resolve` : "Ready to continue");
    setText(this.continue, op === "merge" ? "Commit" : "Continue");
    this.continue.disabled = conflicts > 0 || state.busy > 0;
  }
}
