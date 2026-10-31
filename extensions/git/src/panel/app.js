import { h, toggle, fill } from "@/shared/dom";
import { readString, writeString } from "@/shared/prefs";
import { setDialogAnchor } from "@/shared/actions";
import { changeCount } from "@/core/status";
import * as git from "@/core/git";
import { Controller } from "@/panel/controller";
import { Header, openRepository } from "@/panel/header";
import { Tabs } from "@/panel/tabs";
import { button, placeholder, spinner } from "@/panel/ui";
import { ChangesView } from "@/panel/changes/index";
import { HistoryView } from "@/panel/history/index";
import { PrsView } from "@/panel/prs/index";
import { RunsView } from "@/panel/runs/index";

const TAB_KEY = "muxy.git.tab";
const VIEWS = { changes: ChangesView, history: HistoryView, prs: PrsView, runs: RunsView };

export class PanelApp {
  constructor(root) {
    this.root = root;
    this.ctl = new Controller();
    this.header = new Header(this.ctl);
    this.tabs = new Tabs((id) => this.select(id));
    this.progress = h("div", { class: "progress" });
    this.body = h("div", { class: "body" });
    this.status = h("div", { class: "body-status", hidden: true });
    this.views = new Map();
    this.tab = readString(TAB_KEY, "changes");
    if (!VIEWS[this.tab]) this.tab = "changes";
    this.root.appendChild(h("div", { class: "scm" }, this.header.el, this.progress, this.tabs.el, this.status, this.body));
  }

  start() {
    setDialogAnchor(this.header.el);
    this.ctl.store.subscribe((state, prev) => this.update(state, prev));
    muxy.events.subscribe("command.refresh-scm", () => void this.ctl.load());
    muxy.events.subscribe("command.open-repository", () => void openRepository());
    this.select(this.tab);
    this.update(this.ctl.state, {});
    this.ctl.start();
  }

  view(id) {
    if (!this.views.has(id)) {
      const view = new VIEWS[id](this.ctl);
      view.el.hidden = true;
      this.body.appendChild(view.el);
      this.views.set(id, view);
      view.update(this.ctl.state, {});
    }
    return this.views.get(id);
  }

  select(id) {
    const forge = this.ctl.state.forge;
    if (id === "runs" && forge && forge !== "github") id = "changes";
    this.tab = id;
    writeString(TAB_KEY, id);
    this.tabs.select(id);
    if (this.ctl.state.phase !== "ready") return;
    for (const [viewId, view] of this.views) {
      if (viewId !== id && !view.el.hidden) {
        view.el.hidden = true;
        view.hide?.();
      }
    }
    const view = this.view(id);
    view.el.hidden = false;
    view.show?.();
  }

  renderStatus(state) {
    const ready = state.phase === "ready";
    toggle(this.status, ready);
    toggle(this.body, !ready);
    toggle(this.tabs.el, !ready);
    if (ready) return;
    if (state.phase === "loading") fill(this.status, h("div", { class: "placeholder" }, spinner(16)));
    else if (state.phase === "no_repo")
      fill(this.status, 
        placeholder(
          "Not a Git repository",
          "Initialize a repository to start tracking changes in this folder.",
          button("Initialize Repository", { primary: true, onClick: () => void this.ctl.run("Could not initialize the repository", () => git.initRepo()).then(() => this.ctl.load()) }),
        ),
      );
    else fill(this.status, placeholder("Couldn't read this repository", state.error, button("Try Again", { onClick: () => void this.ctl.load() })));
  }

  update(state, prev) {
    this.header.update(state);
    this.progress.classList.toggle("progress-on", state.busy > 0);
    if (state.phase !== prev.phase || state.error !== prev.error) {
      this.renderStatus(state);
      if (state.phase === "ready") this.select(this.tab);
    }
    if (state.status !== prev.status) this.tabs.setCount("changes", changeCount(state.status));
    if (state.forge !== prev.forge) {
      this.tabs.setVisible("runs", state.forge === "github");
      if (this.tab === "runs" && state.forge && state.forge !== "github" && state.phase === "ready") this.select("changes");
    }
    for (const view of this.views.values()) view.update(state, prev);
  }
}
