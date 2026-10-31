import { h, setText, toggle, fill } from "@/shared/dom";
import { errorMessage, openUrl, toast } from "@/shared/actions";
import * as git from "@/core/git";
import { forgeFor } from "@/core/forge";
import { branchSlug, existingPrUrl } from "@/core/forge/normalize";
import { changeCount } from "@/core/status";
import { baseOptions } from "@/create-pr/bases";

function field(label, control, hint = null) {
  return h("label", { class: "form-field" }, h("span", { class: "form-label" }, label, hint ? h("span", { class: "muted" }, ` ${hint}`) : null), control);
}

export class CreatePrForm {
  constructor(root, { inline = false, onDone = () => {}, onCancel = null } = {}) {
    this.root = root;
    this.inline = inline;
    this.onDone = onDone;
    this.onCancel = onCancel;
    this.status = null;
    this.forge = null;
    this.busy = false;
    this.done = { branch: false, commit: false, push: false };
    this.branchEdited = false;
    this.build();
  }

  build() {
    const input = (attrs) => h("input", { class: "field", spellcheck: "false", autocomplete: "off", ...attrs });
    this.title = input({ placeholder: "Pull request title", oninput: () => this.onTitle() });
    this.body = h("textarea", { class: "field", rows: 5, placeholder: "Describe the changes (optional)", oninput: () => this.sync() });
    this.branch = input({ class: "field mono", placeholder: "feature/name", oninput: () => this.onBranch() });
    this.base = h("select", { class: "field", onchange: () => this.sync() });
    this.draft = h("input", { type: "checkbox" });
    this.commitBox = h("input", { type: "checkbox", checked: true, onchange: () => this.sync() });
    this.commitLabel = h("span", {});
    this.branchField = field("New branch", this.branch, "— you're on the default branch");
    this.commitRow = h("label", { class: "form-check" }, this.commitBox, this.commitLabel);
    this.message = h("span", { class: "form-status", role: "status" });
    this.submit = h("button", { type: "button", class: "btn btn-primary", onclick: () => void this.create() }, "Create Pull Request");
    this.cancel = this.onCancel ? h("button", { type: "button", class: "btn", onclick: () => !this.busy && this.onCancel() }, "Cancel") : null;
    this.context = h("span", { class: "form-context mono" });
    this.root.appendChild(
      h(
        "div",
        { class: this.inline ? "form form-inline" : "form" },
        this.inline ? h("div", { class: "form-context-row" }, h("span", { class: "form-inline-title" }, "New Pull Request"), this.context) : h("header", { class: "form-header" }, h("h1", {}, "Create Pull Request"), this.context),
        h(
          "div",
          { class: "form-body" },
          field("Title", this.title),
          field("Description", this.body),
          this.branchField,
          h("div", { class: "form-grid" }, field("Merge into", this.base), h("label", { class: "form-check form-check-inline" }, this.draft, h("span", {}, "Create as draft"))),
          this.commitRow,
        ),
        h("footer", { class: "form-footer" }, this.message, this.cancel, this.submit),
      ),
    );
    this.root.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void this.create();
      } else if (event.key === "Escape" && !this.busy && this.onCancel) this.onCancel();
    });
  }

  async start() {
    this.title.focus();
    try {
      const [status, branches, repo] = await Promise.all([git.readStatus({ fresh: true }), git.localBranches(), muxy.git.repoInfo()]);
      this.status = status;
      this.forge = await forgeFor(repo.root);
      this.defaultBranch = (await git.defaultBranchOf(status)) ?? "";
      this.fillBases(branches);
    } catch (err) {
      this.setMessage(`Couldn't read the repository: ${errorMessage(err)}`, true);
    }
    this.sync();
  }

  fillBases(branches) {
    const names = baseOptions(branches, this.status.branch, this.defaultBranch);
    fill(this.base, ...names.map((name) => h("option", { value: name, selected: name === this.defaultBranch }, name)));
    if (!names.length) this.base.appendChild(h("option", { value: "" }, "Repository default"));
  }

  onDefault() {
    return !!this.status?.branch && this.status.branch === this.defaultBranch && !this.done.branch;
  }

  onBranch() {
    this.branchEdited = true;
    this.sync();
  }

  onTitle() {
    if (!this.branchEdited && this.onDefault()) this.branch.value = branchSlug(this.title.value);
    this.sync();
  }

  sync() {
    const changes = changeCount(this.status);
    toggle(this.branchField, !this.onDefault());
    toggle(this.commitRow, !changes || this.done.commit);
    setText(this.commitLabel, `Commit ${changes} changed file${changes === 1 ? "" : "s"} with the title as the message`);
    const source = this.onDefault() ? this.branch.value.trim() || "new branch" : this.status?.branch ?? "…";
    setText(this.context, `${source} → ${this.base.value || "default"}`);
    const ready = this.status && this.status.branch && this.title.value.trim() && (!this.onDefault() || this.branch.value.trim());
    this.submit.disabled = this.busy || !ready;
    for (const control of [this.title, this.body, this.base, this.draft, this.commitBox]) control.disabled = this.busy;
    this.branch.disabled = this.busy || this.done.branch;
    setText(this.submit, this.done.push || this.done.commit || this.done.branch ? "Retry" : "Create Pull Request");
    if (this.status && !this.status.branch) this.setMessage("Switch to a branch before opening a pull request.", true);
  }

  setMessage(text, error = false) {
    setText(this.message, text);
    this.message.title = text;
    this.message.classList.toggle("form-status-error", error);
  }

  async step(label, fn) {
    this.setMessage(label);
    await fn();
  }

  async create() {
    if (this.submit.disabled) return;
    const title = this.title.value.trim();
    this.busy = true;
    this.sync();
    try {
      if (this.onDefault()) {
        const name = this.branch.value.trim();
        await this.step(`Creating ${name}…`, () => git.createBranch(name));
        this.done.branch = true;
      }
      if (!this.done.commit && this.commitBox.checked && changeCount(this.status)) {
        await this.step("Committing changes…", () => git.commit(title, true));
      }
      this.done.commit = true;
      if (!this.done.push) {
        await this.step("Pushing…", () => git.push({ setUpstream: true }));
        this.done.push = true;
      }
      await this.step("Opening the pull request…", () =>
        this.forge.api.create({ title, body: this.body.value.trim(), baseBranch: this.base.value || undefined, draft: this.draft.checked }),
      );
      toast(title, this.draft.checked ? "Draft pull request created" : "Pull request created");
      this.busy = false;
      this.onDone({ created: true });
      return;
    } catch (err) {
      const url = existingPrUrl(errorMessage(err));
      if (url) {
        this.busy = false;
        openUrl(url);
        this.onDone({ created: false, url });
        return;
      }
      this.setMessage(errorMessage(err), true);
    }
    this.busy = false;
    this.sync();
  }
}
