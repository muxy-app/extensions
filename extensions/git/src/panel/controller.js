import * as git from "@/core/git";
import { statusKey } from "@/core/status";
import { forgeFor } from "@/core/forge";
import { alertError, errorMessage } from "@/shared/actions";
import { isInside } from "@/shared/paths";
import { createStore } from "@/panel/store";

const FETCH_INTERVAL_MS = 5 * 60 * 1000;
const NO_UPSTREAM = { hasUpstream: false, ahead: 0, behind: 0 };

const INITIAL = {
  phase: "loading",
  error: "",
  repo: null,
  status: null,
  op: null,
  upstream: NO_UPSTREAM,
  forge: null,
  busy: 0,
  headVersion: 0,
};

function isRepoError(message) {
  return /not a git repo/i.test(message);
}

export class Controller {
  constructor() {
    this.store = createStore(INITIAL);
    this.generation = 0;
    this.key = "";
    this.inFlight = false;
    this.again = false;
    this.timer = null;
    this.headInFlight = null;
    this.lastFetch = new Map();
    this.cache = new Map();
    this.disposers = [];
  }

  get state() {
    return this.store.get();
  }

  get root() {
    return this.state.repo?.root ?? null;
  }

  start() {
    const sub = (name, fn) => this.disposers.push(muxy.events.subscribe(name, fn));
    sub("project.switched", () => void this.load());
    sub("worktree.switched", () => void this.load());
    sub("worktree.headChanged", (event) => this.onHeadChanged(event));
    sub("file.changed", (event) => this.onFileChanged(event));
    sub("panel.opened", (event) => {
      if (event?.extensionID === muxy.extensionID) this.onVisible();
    });
    this.disposers.push(muxy.onFocus?.((focused) => focused && this.onVisible()) ?? (() => {}));
    void this.load();
  }

  async load() {
    const generation = ++this.generation;
    this.again = false;
    this.inFlight = false;
    clearTimeout(this.timer);
    this.timer = null;
    let repo;
    try {
      repo = await muxy.git.repoInfo();
    } catch (err) {
      if (generation !== this.generation) return;
      const message = errorMessage(err);
      this.key = "";
      this.store.set({ ...INITIAL, phase: isRepoError(message) ? "no_repo" : "error", error: message });
      return;
    }
    if (generation !== this.generation) return;
    if (!repo?.root) {
      this.store.set({ ...INITIAL, phase: "no_repo" });
      return;
    }
    const cached = this.cache.get(repo.root);
    this.key = cached ? statusKey(cached.status) : "";
    this.store.set({
      ...INITIAL,
      phase: cached ? "ready" : "loading",
      repo,
      status: cached?.status ?? null,
      op: cached?.op ?? null,
      upstream: cached?.upstream ?? NO_UPSTREAM,
      headVersion: this.state.headVersion + 1,
    });
    void forgeFor(repo.root).then((forge) => {
      if (generation === this.generation) this.store.set({ forge: forge.kind });
    });
    await this.refreshStatus({ fresh: false });
    if (generation !== this.generation) return;
    void this.refreshHead().then(() => this.maybeFetch());
    void this.refreshStatus({ fresh: true });
  }

  async refreshStatus({ fresh = true } = {}) {
    if (this.inFlight) {
      this.again = true;
      return;
    }
    this.inFlight = true;
    const generation = this.generation;
    let status = null;
    let error = null;
    try {
      status = await git.readStatus({ fresh });
    } catch (err) {
      error = err;
    }
    if (generation !== this.generation) return;
    this.inFlight = false;
    if (status) this.applyStatus(status);
    else if (!this.state.status) {
      const message = errorMessage(error);
      this.store.set({ phase: isRepoError(message) ? "no_repo" : "error", error: message });
    }
    if (this.again) {
      this.again = false;
      this.scheduleStatus(0);
    }
  }

  applyStatus(status) {
    const prev = this.state.status;
    const key = statusKey(status);
    if (key !== this.key) {
      this.key = key;
      this.store.set({ status, phase: "ready", error: "" });
      this.remember();
    } else if (this.state.phase !== "ready") {
      this.store.set({ phase: "ready", error: "" });
    }
    if (prev && (prev.branch !== status.branch || prev.conflicts.length !== status.conflicts.length)) void this.refreshHead();
  }

  patchStatus(status) {
    this.key = statusKey(status);
    this.store.set({ status });
  }

  remember() {
    const { repo, status, op, upstream } = this.state;
    if (!repo?.root || !status) return;
    this.cache.delete(repo.root);
    this.cache.set(repo.root, { status, op, upstream });
    if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value);
  }

  scheduleStatus(delay = 250) {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refreshStatus();
    }, delay);
  }

  refreshHead() {
    if (this.headInFlight) return this.headInFlight;
    const generation = this.generation;
    const gitDir = this.state.repo?.gitDir;
    this.headInFlight = Promise.all([git.pendingOperation(gitDir), git.upstream()])
      .then(([op, upstream]) => {
        if (generation !== this.generation) return;
        this.store.set({ op, upstream, headVersion: this.state.headVersion + 1 });
        this.remember();
      })
      .finally(() => {
        this.headInFlight = null;
      });
    return this.headInFlight;
  }

  onFileChanged(event) {
    const root = this.root;
    const path = String(event?.path ?? "");
    if (!root || !path) return;
    if (!isInside(path, root) && event?.projectPath !== root) return;
    if (/\/\.git\/(objects|logs|lfs)\//.test(path)) return;
    if (/\/\.git(\/|$)/.test(path)) this.headDirty = true;
    this.scheduleStatus();
    if (this.headDirty && !this.headTimer) {
      this.headTimer = setTimeout(() => {
        this.headTimer = null;
        this.headDirty = false;
        void this.refreshHead();
      }, 400);
    }
  }

  onHeadChanged(event) {
    if (event?.path && this.root && event.path.replace(/\/+$/, "") !== this.root) return;
    this.scheduleStatus(0);
    void this.refreshHead();
  }

  onVisible() {
    if (this.state.phase === "loading") return;
    this.scheduleStatus(0);
    void this.maybeFetch();
  }

  async maybeFetch() {
    const root = this.root;
    if (!root || !this.state.upstream.hasUpstream) return;
    const last = this.lastFetch.get(root) ?? 0;
    if (Date.now() - last < FETCH_INTERVAL_MS) return;
    this.lastFetch.set(root, Date.now());
    try {
      await git.fetch();
    } catch {
      return;
    }
    if (root !== this.root) return;
    await this.refreshHead();
    this.scheduleStatus(0);
  }

  markFetched() {
    if (this.root) this.lastFetch.set(this.root, Date.now());
  }

  async run(label, fn, { alert = true } = {}) {
    this.store.set({ busy: this.state.busy + 1 });
    try {
      return { ok: true, value: await fn() };
    } catch (error) {
      if (alert) await alertError(label, error);
      return { ok: false, error };
    } finally {
      this.store.set({ busy: Math.max(0, this.state.busy - 1) });
      await this.refreshStatus();
      void this.refreshHead();
    }
  }

  dispose() {
    for (const dispose of this.disposers) dispose?.();
    clearTimeout(this.timer);
    clearTimeout(this.headTimer);
  }
}
