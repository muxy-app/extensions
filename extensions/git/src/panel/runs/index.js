import { cls, h, fill } from "@/shared/dom";
import { icon } from "@/shared/icons";
import { openMenu } from "@/shared/menu";
import { confirmAction, errorMessage, openUrl } from "@/shared/actions";
import { relativeTime } from "@/shared/time";
import { forgeFor } from "@/core/forge";
import { chips, iconButton, placeholder, spinner } from "@/panel/ui";
import { openPicker } from "@/shared/popover";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "branch", label: "This Branch" },
  { value: "failed", label: "Failed" },
];
const POLL_MS = 15 * 1000;

export function runState(run) {
  if (run.status !== "completed") return "running";
  if (run.conclusion === "success") return "success";
  if (["failure", "timed_out", "startup_failure"].includes(run.conclusion)) return "failure";
  if (run.conclusion === "cancelled") return "cancelled";
  return "neutral";
}

const STATE_ICON = { running: "loader", success: "checkCircle", failure: "xCircle", cancelled: "circle", neutral: "circle" };

export class RunsView {
  constructor(ctl) {
    this.ctl = ctl;
    this.visible = false;
    this.filter = "all";
    this.workflow = "";
    this.workflowLabel = h("span", { class: "btn-label" }, "All workflows");
    this.workflowButton = h("button", { type: "button", class: "workflow-button", onclick: () => this.pickWorkflow() }, icon("play", 12), this.workflowLabel, icon("chevronDown", 12));
    this.data = { phase: "idle", runs: [], error: "", key: "" };
    this.loadId = 0;
    this.pending = new Set();
    this.chipsHost = h("div", { class: "pr-filters" });
    this.refreshButton = iconButton("refresh", "Refresh", { small: true, onClick: () => this.load() });
    this.listHost = h("div", { class: "pr-list" });
    this.el = h(
      "section",
      { class: "view runs" },
      h("div", { class: "pr-list-head" }, this.workflowButton, h("span", { class: "spacer" }), this.refreshButton),
      this.chipsHost,
      this.listHost,
    );
    this.listHost.addEventListener("click", (event) => this.onClick(event));
    this.listHost.addEventListener("contextmenu", (event) => this.onMenu(event));
  }

  async load() {
    const branch = this.ctl.state.status?.branch;
    const key = `${this.ctl.root}\n${this.filter === "branch" ? branch : ""}`;
    if (this.data.key !== key) this.data = { phase: "loading", runs: [], error: "", key };
    const id = ++this.loadId;
    this.refreshing = true;
    this.render();
    try {
      const forge = await forgeFor(this.ctl.root);
      const runs = await forge.api.runs({ branch: this.filter === "branch" ? branch : undefined });
      if (id !== this.loadId) return;
      this.data = { phase: "ready", runs, error: "", key };
    } catch (err) {
      if (id !== this.loadId) return;
      this.data = { ...this.data, phase: this.data.runs.length ? "ready" : "error", error: errorMessage(err) };
    }
    this.refreshing = false;
    this.render();
    this.schedulePoll();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (this.visible && this.data.runs.some((run) => runState(run) === "running")) this.pollTimer = setTimeout(() => this.load(), POLL_MS);
  }

  render() {
    fill(this.chipsHost, 
      chips(FILTERS, this.filter, (value) => {
        this.filter = value;
        this.load();
      }),
    );
    fill(this.refreshButton, this.refreshing ? icon("loader", 13, "spin") : icon("refresh", 13));
    const { phase, runs, error } = this.data;
    if (phase === "loading" || phase === "idle") return fill(this.listHost, h("div", { class: "placeholder" }, spinner(16)));
    if (phase === "error") return fill(this.listHost, placeholder("Couldn't load workflow runs", error));
    const visible = runs.filter((run) => (this.filter !== "failed" || runState(run) === "failure") && (!this.workflow || run.workflow === this.workflow));
    if (!visible.length) return fill(this.listHost, placeholder("No workflow runs"));
    fill(this.listHost, ...visible.map((run) => this.row(run)));
  }

  row(run) {
    const state = runState(run);
    const busy = this.pending.has(run.id);
    const el = h(
      "div",
      { class: "pr-row", title: run.title },
      h("span", { class: cls("run-icon", `run-${state}`) }, icon(busy ? "loader" : STATE_ICON[state], 14, state === "running" || busy ? "spin" : "")),
      h(
        "span",
        { class: "pr-row-text" },
        h("span", { class: "pr-row-title" }, run.title),
        h("span", { class: "pr-row-meta" }, [run.workflow, run.branch, relativeTime(run.createdAt)].filter(Boolean).join(" · ")),
      ),
      h(
        "span",
        { class: "row-actions" },
        state === "running" ? iconButton("x", "Cancel Run", { action: "cancel", small: true }) : iconButton("refresh", "Re-run", { action: "rerun", small: true }),
        state === "failure" ? iconButton("undo", "Re-run Failed Jobs", { action: "rerun-failed", small: true }) : null,
        iconButton("external", "Open in Browser", { action: "browser", small: true }),
      ),
    );
    el._run = run;
    return el;
  }

  pickWorkflow() {
    const names = [...new Set(this.data.runs.map((run) => run.workflow).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    openPicker({
      anchor: this.workflowButton,
      placeholder: "Filter workflows",
      cached: names,
      filter: (items, query) => [{ name: "", label: "All workflows", icon: this.workflow ? null : "check" }, ...items.filter((name) => name.toLowerCase().includes(query.toLowerCase())).map((name) => ({ name, label: name, icon: name === this.workflow ? "check" : null }))],
      onPick: (row) => {
        this.workflow = row.name;
        this.workflowLabel.textContent = row.name || "All workflows";
        this.render();
      },
    });
  }

  async perform(run, action) {
    if (action === "browser") return openUrl(run.url);
    if (action === "cancel" && !(await confirmAction({ title: "Cancel this run?", message: run.title, confirmLabel: "Cancel Run", critical: true }))) return;
    const forge = await forgeFor(this.ctl.root);
    this.pending.add(run.id);
    this.render();
    await this.ctl.run(action === "cancel" ? "Could not cancel the run" : "Could not re-run", () =>
      action === "cancel" ? forge.api.cancelRun(run.id) : forge.api.rerun(run.id, action === "rerun-failed"),
    );
    this.pending.delete(run.id);
    await this.load();
  }

  onClick(event) {
    const row = event.target.closest?.(".pr-row");
    if (!row?._run) return;
    const action = event.target.closest?.("[data-action]")?.dataset.action ?? "browser";
    void this.perform(row._run, action);
  }

  onMenu(event) {
    const row = event.target.closest?.(".pr-row");
    if (!row?._run) return;
    event.preventDefault();
    const run = row._run;
    const state = runState(run);
    openMenu(
      [
        { label: "Open in Browser", run: () => openUrl(run.url) },
        "-",
        { label: "Re-run", disabled: state === "running", run: () => void this.perform(run, "rerun") },
        { label: "Re-run Failed Jobs", disabled: state !== "failure", run: () => void this.perform(run, "rerun-failed") },
        { label: "Cancel Run…", danger: true, disabled: state !== "running", run: () => void this.perform(run, "cancel") },
      ],
      event.clientX,
      event.clientY,
    );
  }

  update(state, prev) {
    if (state.repo?.root !== prev.repo?.root) this.data = { phase: "idle", runs: [], error: "", key: "" };
    if (this.visible && this.filter === "branch" && prev.status && state.status?.branch !== prev.status?.branch) void this.load();
  }

  show() {
    this.visible = true;
    void this.load();
  }

  hide() {
    this.visible = false;
    clearTimeout(this.pollTimer);
  }
}
