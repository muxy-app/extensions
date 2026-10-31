import { h, setText, toggle, fill } from "@/shared/dom";
import { icon } from "@/shared/icons";
import { alertError, confirmAction, errorMessage, openInEditor, setDialogAnchor } from "@/shared/actions";
import { readJson, readString, removeKey, writeJson, writeString } from "@/shared/prefs";
import { isInside } from "@/shared/paths";
import { REQUEST_KEY, STATE_PREFIX, TAB_PREFIX, diffKind, forgetTab, registeredTabs, sendToTab } from "@/shared/diff-tabs";
import * as git from "@/core/git";
import { PrDetail } from "@/panel/prs/detail";
import { splitCombined } from "@/diff/patch";
import { loadSource } from "@/diff/sources";
import { DiffViewer, parseGroup } from "@/diff/viewer";
import { FileRail } from "@/diff/file-rail";
import { renderInfo } from "@/diff/info";

const PREF = "muxy.git.diff.";
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 1.8;
const RAIL_MIN = 180;
const RAIL_MAX = 520;

function toolButton(name, title, onClick) {
  return h("button", { type: "button", class: "icon-btn", title, "aria-label": title, onclick: onClick }, icon(name, 14));
}

export class DiffApp {
  constructor(root) {
    this.root = root;
    this.tab = muxy.tabInstanceID ?? "page";
    this.repoRoot = null;
    this.data = this.initialData();
    this.loadId = 0;
    this.dirty = false;
    this.loadedAt = 0;
    this.source = null;
    this.items = [];
    this.infoExpanded = readString(`${PREF}info`, "1") === "1";
    this.zoom = Number(readString(`${PREF}zoom`, "1")) || 1;
    this.build();
  }

  initialData() {
    const base = JSON.stringify(muxy.data ?? {});
    const saved = readJson(STATE_PREFIX + this.tab);
    return saved && saved.base === base ? saved.data : { ...(muxy.data ?? {}) };
  }

  build() {
    this.titleNode = h("span", { class: "topbar-title" });
    this.summary = h("span", { class: "topbar-summary" });
    this.zoomLabel = h("button", { type: "button", class: "zoom-label", title: "Reset Zoom (⌘0)", onclick: () => this.setZoom(1) });
    this.styleButton = toolButton("split", "", () => this.toggleStyle());
    this.wrapButton = toolButton("wrap", "", () => this.toggleWrap());
    this.topbar = h(
      "header",
      { class: "topbar" },
      this.titleNode,
      this.summary,
      h("span", { class: "topbar-spacer" }),
      toolButton("minus", "Zoom Out (⌘−)", () => this.setZoom(this.zoom - 0.1)),
      this.zoomLabel,
      toolButton("plus", "Zoom In (⌘+)", () => this.setZoom(this.zoom + 0.1)),
      h("span", { class: "topbar-divider" }),
      this.styleButton,
      this.wrapButton,
      toolButton("collapse", "Collapse All Files", () => this.viewer.setAllCollapsed(true)),
      toolButton("expand", "Expand All Files", () => this.viewer.setAllCollapsed(false)),
      h("span", { class: "topbar-divider" }),
      toolButton("refresh", "Refresh", () => void this.load()),
    );
    this.rail = new FileRail({
      onSelect: (id) => this.viewer.reveal(id),
      actionsFor: (item) => this.actionsFor(item),
      onAction: (action, item) => void this.fileAction(action, item),
    });
    this.resize = h("div", { class: "rail-resize", role: "separator", "aria-orientation": "vertical" });
    this.infoHost = h("div", { class: "info-host" });
    this.notes = h("div", { class: "notes", hidden: true });
    this.viewerHost = h("div", { class: "viewer" });
    this.overlay = h("div", { class: "overlay", hidden: true });
    this.main = h(
      "div",
      { class: "diff-main" },
      h("aside", { class: "diff-rail" }, this.rail.el, this.resize),
      h("section", { class: "diff-content" }, this.infoHost, this.notes, h("div", { class: "viewer-wrap" }, this.viewerHost, this.overlay)),
    );
    this.root.appendChild(h("div", { class: "diff-app" }, this.topbar, this.main));
    this.viewer = new DiffViewer(this.viewerHost, {
      onActive: (id) => this.rail.setActive(id),
      onHeaderAction: (action, item) => void this.fileAction(action, item),
      headerActions: (item) => this.headerActions(item),
    });
    this.viewer.configure({ style: readString(`${PREF}style`, "split"), wrap: readString(`${PREF}wrap`, "1") === "1", zoom: this.zoom });
    this.applyRailWidth(Number(readString(`${PREF}rail`, "260")) || 260);
    this.syncToolbar();
    this.bindResize();
  }

  async start() {
    setDialogAnchor(this.topbar);
    window.addEventListener("storage", (event) => this.onStorage(event));
    window.addEventListener("keydown", (event) => this.onKey(event));
    document.addEventListener("visibilitychange", () => this.onVisible());
    muxy.onFocus?.((focused) => focused && this.onVisible());
    muxy.onThemeChange?.(() => this.viewer.themeChanged());
    muxy.onDataChange?.((data) => this.apply({ ...(data ?? {}) }, false));
    muxy.events.subscribe("file.changed", (event) => this.onFileChanged(event));
    muxy.lifecycle.onBeforeClose(() => {
      forgetTab(this.tab);
      removeKey(STATE_PREFIX + this.tab);
      return false;
    });
    const info = await muxy.git.repoInfo().catch(() => null);
    this.repoRoot = info?.root ?? "";
    if (await this.handoff()) return;
    this.register();
    await this.load();
  }

  async handoff() {
    if (!this.data.handoff) return false;
    const { handoff, ...data } = this.data;
    this.data = data;
    for (const { tab } of registeredTabs(this.repoRoot, diffKind(data), this.tab)) {
      if (await sendToTab(tab, data)) {
        void muxy.lifecycle.close();
        return true;
      }
    }
    return false;
  }

  register() {
    writeJson(TAB_PREFIX + this.tab, { root: this.repoRoot, kind: diffKind(this.data), at: Date.now() });
    writeJson(STATE_PREFIX + this.tab, { base: JSON.stringify(muxy.data ?? {}), data: this.data });
  }

  onStorage(event) {
    if (event.key !== REQUEST_KEY || !event.newValue) return;
    let request;
    try {
      request = JSON.parse(event.newValue);
    } catch {
      return;
    }
    if (request?.tab !== this.tab || Date.now() - (request.at ?? 0) > 10000) return;
    this.apply(request.data, true);
  }

  apply(data, fromRequest) {
    const sameSource = JSON.stringify({ ...this.data, focus: null }) === JSON.stringify({ ...data, focus: null });
    this.data = data;
    if (fromRequest) this.register();
    if (sameSource && !this.dirty && Date.now() - this.loadedAt < 60000 && this.items.length) this.focusRequested();
    else void this.load();
  }

  async load() {
    const id = ++this.loadId;
    this.dirty = false;
    if (!this.items.length) this.showOverlay(h("div", { class: "placeholder" }, icon("loader", 16, "spin")));
    let source;
    try {
      source = await loadSource(this.repoRoot, this.data);
    } catch (err) {
      if (id !== this.loadId) return;
      this.source = null;
      this.items = [];
      this.viewer.setItems([]);
      this.rail.setGroups([]);
      this.renderHeader("Changes", "");
      this.showOverlay(this.placeholder("Couldn't load the changes", errorMessage(err), true));
      return;
    }
    if (id !== this.loadId) return;
    this.loadedAt = Date.now();
    this.source = source;
    const notes = [...source.notes];
    const groups = source.groups.map((group) => {
      const { patch, combined } = splitCombined(group.patch);
      if (combined.length && source.status === undefined) notes.push(`${combined.length} combined diff${combined.length === 1 ? "" : "s"} skipped.`);
      return { ...group, items: parseGroup({ ...group, patch }) };
    });
    this.items = groups.flatMap((group) => group.items);
    this.viewer.setItems(this.items);
    this.rail.setGroups(groups);
    this.renderNotes(notes);
    this.renderInfo();
    const additions = this.items.reduce((sum, item) => sum + item.additions, 0);
    const deletions = this.items.reduce((sum, item) => sum + item.deletions, 0);
    this.renderHeader(source.title, this.items.length ? `${this.items.length} file${this.items.length === 1 ? "" : "s"} · +${additions} −${deletions}` : "");
    if (!this.items.length) this.showOverlay(this.placeholder("No changes", source.empty));
    else this.hideOverlay();
    this.focusRequested();
  }

  focusRequested() {
    const focus = this.data.focus;
    if (!focus?.path) return;
    const groups = focus.section === "staged" ? ["staged"] : ["unstaged", "staged"];
    for (const group of groups) {
      const id = `${group}:${focus.path}`;
      if (this.items.some((item) => item.id === id)) return this.viewer.reveal(id);
    }
  }

  renderHeader(title, summary) {
    setText(this.titleNode, title);
    this.titleNode.title = title;
    setText(this.summary, summary);
    void muxy.tabs.setTitle?.(title.length > 48 ? `${title.slice(0, 47)}…` : title)?.catch?.(() => undefined);
  }

  renderNotes(notes) {
    toggle(this.notes, !notes.length);
    fill(this.notes, ...notes.map((note) => h("div", { class: "note" }, icon("warning", 12), h("span", {}, note))));
  }

  renderInfo() {
    const node = renderInfo(this.source?.info, {
      expanded: this.infoExpanded,
      onToggle: () => {
        this.infoExpanded = !this.infoExpanded;
        writeString(`${PREF}info`, this.infoExpanded ? "1" : "0");
        this.renderInfo();
      },
      onOpenCommit: (hash) => this.apply({ source: "commit", hash }, true),
      prDetail: this.prDetail(),
    });
    fill(this.infoHost, ...(node ? [node] : []));
  }

  placeholder(title, detail, retry = false) {
    return h(
      "div",
      { class: "placeholder" },
      h("div", { class: "placeholder-title" }, title),
      detail ? h("div", { class: "placeholder-detail" }, detail) : null,
      retry ? h("button", { type: "button", class: "btn", onclick: () => void this.load() }, "Try Again") : null,
    );
  }

  showOverlay(node) {
    fill(this.overlay, node);
    toggle(this.overlay, false);
  }

  hideOverlay() {
    toggle(this.overlay, true);
  }

  isWorking() {
    return diffKind(this.data) === "working";
  }

  actionsFor(item) {
    const open = item.code !== "D" ? [["open", "Open File", "openFile"]] : [];
    if (!this.isWorking()) return open;
    if (item.group === "staged") return [...open, ["unstage", "Unstage", "minus"]];
    return [...open, ["discard", "Discard Changes", "undo"], ["stage", "Stage", "plus"]];
  }

  headerActions(item) {
    if (!item) return null;
    const actions = this.actionsFor(item);
    if (!actions.length) return null;
    return h(
      "span",
      { class: "dh-actions" },
      actions.map(([action, title]) => h("button", { type: "button", class: "dh-action", title, dataset: { diffAction: action, itemId: item.id } }, title.replace(" Changes", ""))),
    );
  }

  async fileAction(action, item) {
    if (!item) return;
    if (action === "open") return void openInEditor(item.path);
    const untracked = item.code === "A" && item.group === "unstaged";
    try {
      if (action === "stage") await git.stage([item.path]);
      else if (action === "unstage") await git.unstage([item.path]);
      else if (action === "discard") {
        const ok = await confirmAction({
          title: "Discard changes?",
          message: untracked ? `“${item.path}” is untracked and will be deleted.` : `Your changes to “${item.path}” will be lost. This can't be undone.`,
          confirmLabel: untracked ? "Delete File" : "Discard",
          critical: true,
        });
        if (!ok) return;
        await (untracked ? git.discard([], [item.path]) : git.discard([item.path], []));
      }
    } catch (err) {
      await alertError("Couldn't update the file", err);
    }
    await this.load();
  }

  prDetail() {
    const details = this.source?.info?.kind === "pr" ? this.source.info.details : null;
    if (!details) return null;
    if (!this.prView) {
      const ctl = {
        root: this.repoRoot,
        state: { status: null, forge: this.source.info.forge, repo: null },
        run: async (label, fn) => {
          try {
            return { ok: true, value: await fn() };
          } catch (error) {
            await alertError(label, error);
            return { ok: false, error };
          }
        },
      };
      this.prView = new PrDetail(ctl, { hideChanges: true, onChanged: () => void this.load() });
    }
    void this.prView.open(details, { preloaded: true });
    return this.prView;
  }

  onFileChanged(event) {
    if (!this.isWorking() || !this.repoRoot) return;
    const path = String(event?.path ?? "");
    if (!isInside(path, this.repoRoot) || /\/\.git\/(objects|logs)\//.test(path)) return;
    this.dirty = true;
    clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => this.onVisible(), 600);
  }

  onVisible() {
    if (!this.dirty || document.visibilityState === "hidden") return;
    void this.load();
  }

  onKey(event) {
    if (!(event.metaKey || event.ctrlKey)) return;
    if (event.key === "=" || event.key === "+") this.setZoom(this.zoom + 0.1);
    else if (event.key === "-" || event.key === "_") this.setZoom(this.zoom - 0.1);
    else if (event.key === "0") this.setZoom(1);
    else return;
    event.preventDefault();
  }

  setZoom(value) {
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 10) / 10));
    writeString(`${PREF}zoom`, String(this.zoom));
    this.viewer.configure({ zoom: this.zoom });
    this.syncToolbar();
  }

  toggleStyle() {
    const style = this.viewer.style === "split" ? "unified" : "split";
    writeString(`${PREF}style`, style);
    this.viewer.configure({ style });
    this.syncToolbar();
  }

  toggleWrap() {
    const wrap = !this.viewer.wrap;
    writeString(`${PREF}wrap`, wrap ? "1" : "0");
    this.viewer.configure({ wrap });
    this.syncToolbar();
  }

  syncToolbar() {
    document.documentElement.style.setProperty("--diff-zoom", String(this.zoom));
    setText(this.zoomLabel, `${Math.round(this.zoom * 100)}%`);
    this.styleButton.title = this.viewer.style === "split" ? "Switch to Unified View" : "Switch to Split View";
    this.styleButton.classList.toggle("icon-btn-on", this.viewer.style === "split");
    this.wrapButton.title = this.viewer.wrap ? "Turn Off Line Wrap" : "Turn On Line Wrap";
    this.wrapButton.classList.toggle("icon-btn-on", this.viewer.wrap);
  }

  applyRailWidth(width) {
    const clamped = Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(width)));
    this.main.style.setProperty("--rail-width", `${clamped}px`);
    return clamped;
  }

  bindResize() {
    this.resize.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.resize.setPointerCapture(event.pointerId);
      document.body.classList.add("resizing");
      const startX = event.clientX;
      const startWidth = this.resize.parentElement.getBoundingClientRect().width;
      let width = startWidth;
      const move = (next) => {
        width = this.applyRailWidth(startWidth + next.clientX - startX);
      };
      const up = () => {
        document.body.classList.remove("resizing");
        this.resize.removeEventListener("pointermove", move);
        this.resize.removeEventListener("pointerup", up);
        writeString(`${PREF}rail`, String(width));
      };
      this.resize.addEventListener("pointermove", move);
      this.resize.addEventListener("pointerup", up);
    });
  }
}
