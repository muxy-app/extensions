import { clear, h, readPref, writePref } from "@/lib/dom";
import { computeLanes, toCommitNode } from "@/lib/graph";
import {
  alertError,
  activeWorktreePath,
  commitAll,
  confirmAction,
  hasPendingChanges,
  isBusy,
  onBusyChange,
  runPinned,
  toViewStatus,
  tryAction,
} from "@/lib/git";
import {
  checkoutPr,
  checkoutPrWorktree,
  cleanupBranch,
  closePr,
  confirmOpenExistingPr,
  createPr,
  mergePr,
  removeWorktreeOrBranch,
} from "@/lib/pr";
import type {
  CleanupTarget,
  CommitNode,
  CreatePrInput,
  GraphState,
  MergeMethod,
  PrAction,
  PrFilter,
  RepoState,
  RowAction,
  TabId,
} from "@/lib/types";
import { icon } from "@/lib/icons";
import { button, emptyState, iconButton, loadingOverlay } from "@/ui/shared";
import { renderBranchSwitcher, renderBranchTab } from "@/panel/branch";
import { renderHistoryTab } from "@/panel/history";
import { renderPrsTab } from "@/panel/prs";

const TAB_KEY = "muxy.git.panel.tab";
const FILTER_KEY = "muxy.git.prs.filter";
const PAGE = 50;

type PrListState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; prs: MuxyGitPRListItem[] };

export class GitPanelApp {
  root: HTMLElement;
  repo: RepoState = { kind: "loading" };
  switching = false;
  refreshing = false;
  tab = readPref<TabId>(TAB_KEY, "branch");
  message = "";
  commitBusy: "commit" | "pull" | "push" | null = null;
  prPending: PrAction | null = null;
  prFilter = readPref<PrFilter>(FILTER_KEY, "open");
  prList: PrListState = { kind: "idle" };
  prListRefreshing = false;
  prStarted = false;
  prRowPending = new Map<number, RowAction>();
  graph: GraphState = { rows: [], hasMore: false, loading: true };
  createForm = {
    title: "",
    body: "",
    newBranch: "",
    branchEdited: false,
    draft: false,
    advanced: false,
    busy: false,
  };
  private refreshId = 0;
  private statusCache = new Map<string, RepoState>();
  private pendingSwitch = false;
  private reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  private graphCommits: CommitNode[] = [];
  private graphLoadId = 0;
  private graphCache = new Map<string, { commits: CommitNode[]; hasMore: boolean }>();
  private disposers: Array<() => void> = [];

  constructor(root: HTMLElement) {
    this.root = root;
  }

  start(): void {
    this.render();
    void this.loadLocal(true);
    void this.resetGraph(false);
    this.disposers = [
      muxy.events.subscribe("project.switched", () => void this.switchScope()),
      muxy.events.subscribe("worktree.switched", () => void this.switchScope()),
      muxy.events.subscribe("file.changed", () => this.reconcile()),
      muxy.events.subscribe("command.refresh-scm", () => this.runRefresh()),
      muxy.events.subscribe("project.switched", () => void this.resetGraph(false)),
      muxy.events.subscribe("worktree.switched", () => void this.resetGraph(false)),
      muxy.events.subscribe("project.switched", () => this.reloadPrListOnScopeChange()),
      muxy.events.subscribe("worktree.switched", () => this.reloadPrListOnScopeChange()),
      onBusyChange((busy) => {
        if (busy || !this.pendingSwitch) return;
        this.pendingSwitch = false;
        void this.switchScope();
      }),
    ].filter(Boolean);
  }

  dispose(): void {
    for (const dispose of this.disposers) dispose();
    if (this.reconcileTimer) clearTimeout(this.reconcileTimer);
  }

  render(): void {
    clear(this.root);

    if (this.repo.kind === "loading") {
      this.root.appendChild(h("div", { class: "relative h-screen" }, loadingOverlay()));
      return;
    }

    if (this.repo.kind === "no_repo") {
      this.root.appendChild(
        h(
          "div",
          { class: "flex h-screen flex-col" },
          emptyState(
            h("div", {}, "This folder is not a Git repository."),
            button("Initialize Repository", {
              variant: "outline",
              onClick: () => void this.initRepo(),
            }),
          ),
        ),
      );
      return;
    }

    const status = this.repo.status;
    const changes = status.staged.length + status.unstaged.length;
    const panel = h(
      "div",
      { class: "flex h-full min-h-0 flex-col" },
      h(
        "header",
        { class: "flex shrink-0 items-center border-b border-border pr-1" },
        h("div", { class: "min-w-0 flex-1" }, renderBranchSwitcher(this, status)),
        iconButton("Refresh", "refresh", () => this.runRefresh()),
      ),
      this.renderTabs(changes),
      this.tab === "branch"
        ? renderBranchTab(this, status)
        : this.tab === "prs"
          ? renderPrsTab(this, status)
          : renderHistoryTab(this),
    );
    const shell = h("div", { class: "relative flex h-screen flex-col" }, panel);
    if (this.switching) shell.appendChild(loadingOverlay("Loading worktree..."));
    else if (this.refreshing) shell.appendChild(loadingOverlay("Refreshing..."));
    this.root.appendChild(shell);
  }

  setTab(tab: TabId): void {
    this.tab = tab;
    writePref(TAB_KEY, tab);
    this.render();
  }

  setMessage(message: string): void {
    this.message = message;
  }

  async initRepo(): Promise<void> {
    if (await tryAction(() => muxy.git.init(), "Could not initialize repository")) {
      await this.loadLocal(true);
    }
  }

  refreshAll(): void {
    void this.loadLocal(true);
    void this.resetGraph(true);
  }

  runRefresh(): void {
    this.refreshing = true;
    this.render();
    void this.resetGraph(true);
    void Promise.all([this.loadLocal(true), new Promise((resolve) => setTimeout(resolve, 400))])
      .finally(() => {
        this.refreshing = false;
        this.render();
      });
  }

  async loadLocal(withPr: boolean): Promise<void> {
    const id = ++this.refreshId;
    const cwd = await activeWorktreePath();
    let next: RepoState;
    try {
      const status = toViewStatus(await muxy.git.status({ local: true }));
      const prev = cwd ? this.statusCache.get(cwd) : undefined;
      if (prev?.kind === "ready" && prev.status.branch === status.branch) {
        status.pullRequest = prev.status.pullRequest;
        status.defaultBranch = prev.status.defaultBranch;
      }
      next = { kind: "ready", status };
    } catch {
      next = { kind: "no_repo" };
    }
    if (this.refreshId !== id) return;
    if (cwd) this.statusCache.set(cwd, next);
    this.repo = next;
    this.switching = false;
    this.render();
    if (withPr && next.kind === "ready") void this.resolvePr(cwd, next.status.branch);
  }

  async stage(path: string): Promise<boolean> {
    this.moveEntry(path, "unstaged", "staged");
    const ok = await tryAction(
      () => runPinned((project) => muxy.git.stage({ paths: [path], project })),
      "Could not stage file",
    );
    if (ok) this.reconcile();
    else await this.loadLocal(false);
    return ok;
  }

  async unstage(path: string): Promise<boolean> {
    this.moveEntry(path, "staged", "unstaged");
    const ok = await tryAction(
      () => runPinned((project) => muxy.git.unstage({ paths: [path], project })),
      "Could not unstage file",
    );
    if (ok) this.reconcile();
    else await this.loadLocal(false);
    return ok;
  }

  async discard(path: string): Promise<boolean> {
    const entry =
      this.repo.kind === "ready" ? this.repo.status.unstaged.find((file) => file.path === path) : undefined;
    const untracked = entry?.label === "?";
    const ok = await tryAction(
      () =>
        runPinned((project) =>
          muxy.git.discard(
            untracked ? { untrackedPaths: [path], project } : { paths: [path], project },
          ),
        ),
      "Could not discard file",
    );
    await this.loadLocal(false);
    return ok;
  }

  async discardAll(): Promise<boolean> {
    if (this.repo.kind !== "ready") return false;
    const paths = this.repo.status.unstaged.filter((file) => file.label !== "?").map((file) => file.path);
    const untrackedPaths = this.repo.status.unstaged.filter((file) => file.label === "?").map((file) => file.path);
    const ok = await tryAction(
      () => runPinned((project) => muxy.git.discard({ paths, untrackedPaths, project })),
      "Could not discard changes",
    );
    await this.loadLocal(false);
    return ok;
  }

  async stageAll(): Promise<boolean> {
    const ok = await tryAction(
      () => runPinned((project) => muxy.git.stage({ paths: [], project })),
      "Could not stage changes",
    );
    await this.loadLocal(false);
    return ok;
  }

  async unstageAll(): Promise<boolean> {
    const ok = await tryAction(
      () => runPinned((project) => muxy.git.unstage({ paths: [], project })),
      "Could not unstage changes",
    );
    await this.loadLocal(false);
    return ok;
  }

  async commit(message: string): Promise<boolean> {
    const ok = await tryAction(
      () => runPinned((project) => muxy.git.commit({ message, project })),
      "Commit failed",
    );
    if (ok) {
      await this.loadLocal(false);
      void this.resetGraph(true);
    }
    return ok;
  }

  async sync(op: "pull" | "push"): Promise<boolean> {
    const ok = await tryAction(
      () =>
        runPinned((project) =>
          op === "push" ? muxy.git.push({ project }) : muxy.git.pull({ project }),
        ),
      op === "push" ? "Push failed" : "Pull failed",
    );
    if (ok) {
      await this.loadLocal(true);
      void this.resetGraph(true);
    }
    return ok;
  }

  async switchBranch(name: string, create: boolean): Promise<void> {
    const ok = await tryAction(
      () =>
        runPinned((project) =>
          create
            ? muxy.git.branch.create({ name, project })
            : muxy.git.branch.switchTo({ branch: name, project }),
        ),
      create ? "Could not create branch" : "Could not switch branch",
    );
    if (ok) {
      await this.loadLocal(true);
      void this.resetGraph(true);
    }
  }

  async deleteBranch(name: string): Promise<boolean> {
    const confirmed = await confirmAction({
      title: `Delete branch "${name}"?`,
      message: `This permanently deletes the local branch "${name}".`,
      confirmLabel: "Delete",
      critical: true,
    });
    if (!confirmed) return false;
    return tryAction(
      () => runPinned((project) => muxy.git.branch.delete({ name, force: true, project })),
      "Could not delete branch",
    );
  }

  async createPullRequest(input: CreatePrInput): Promise<boolean> {
    try {
      return await runPinned(async (project) => {
        if (input.newBranch) await muxy.git.branch.create({ name: input.newBranch, project });
        if (await hasPendingChanges(project)) {
          const committed = await commitAll(input.title, project);
          if (!committed) return false;
        }
        await muxy.git.push({ setUpstream: true, project });
        await createPr(input.title, input.body, input.baseBranch, input.draft ?? false, project);
        await this.loadLocal(true);
        return true;
      });
    } catch (err) {
      if (await confirmOpenExistingPr(err, () => this.loadLocal(true))) return false;
      await alertError("Could not create pull request", err);
      return false;
    }
  }

  async mergeCurrentPr(number: number, method: MergeMethod, target: CleanupTarget): Promise<boolean> {
    this.prPending = method;
    this.render();
    let cleanupProject: string | undefined;
    try {
      await runPinned((project) => {
        cleanupProject = project;
        return mergePr(number, method, false, project);
      });
    } catch (err) {
      await alertError(`Could not merge PR #${number}`, err);
      this.prPending = null;
      this.render();
      return false;
    }
    try {
      await removeWorktreeOrBranch(
        { branch: target.branch, defaultBranch: target.defaultBranch, dirty: false },
        cleanupProject,
      );
    } catch (err) {
      await alertError(`PR #${number} merged, but branch cleanup failed`, err);
    } finally {
      this.prPending = null;
      this.render();
    }
    return true;
  }

  async closeCurrentPr(number: number): Promise<boolean> {
    this.prPending = "close";
    this.render();
    try {
      await runPinned((project) => closePr(number, project));
      return true;
    } catch (err) {
      await alertError(`Could not close PR #${number}`, err);
      return false;
    } finally {
      this.prPending = null;
      this.render();
    }
  }

  async cleanupCurrentBranch(target: CleanupTarget): Promise<boolean> {
    this.prPending = "cleanup";
    this.render();
    try {
      return await cleanupBranch(target);
    } finally {
      this.prPending = null;
      this.render();
    }
  }

  setPrFilter(filter: PrFilter): void {
    this.prFilter = filter;
    writePref(FILTER_KEY, filter);
    if (this.prStarted) void this.loadPrList(false);
    else this.render();
  }

  async loadPrList(fresh = false): Promise<void> {
    this.prStarted = true;
    this.prListRefreshing = true;
    if (this.prList.kind !== "ready") this.prList = { kind: "loading" };
    this.render();
    try {
      const prs = await muxy.git.pr.list({ filter: this.prFilter, limit: 50, fresh });
      this.prList = { kind: "ready", prs };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.prList = { kind: "error", message: message.trim() || "Could not load pull requests." };
    } finally {
      this.prListRefreshing = false;
      this.render();
    }
  }

  async checkoutPrRow(number: number): Promise<void> {
    const ok = await confirmAction({
      title: `Checkout PR #${number}?`,
      message: `This checks out the branch for pull request #${number} in the current worktree.`,
      confirmLabel: "Checkout",
    });
    if (!ok) return;
    await this.runRowAction(number, "checkout", async () => {
      await runPinned((project) => checkoutPr(number, project));
      await muxy.worktrees.refresh().catch(() => undefined);
      await muxy.toast({ body: `Checked out PR #${number}`, variant: "success" });
    }, `Could not checkout PR #${number}`);
  }

  async checkoutPrWorktreeRow(number: number): Promise<void> {
    const ok = await confirmAction({
      title: `Checkout PR #${number} to worktree?`,
      message: `This creates a new worktree for pull request #${number} and switches to it.`,
      confirmLabel: "Continue",
    });
    if (!ok) return;
    await this.runRowAction(number, "worktree", async () => {
      const branch = await runPinned((project) => checkoutPrWorktree(number, project));
      if (branch) await muxy.toast({ body: `PR #${number} in worktree (${branch})`, variant: "success" });
    }, `Could not create worktree for PR #${number}`);
  }

  async closePrRow(number: number): Promise<void> {
    const ok = await confirmAction({
      title: `Close PR #${number}?`,
      message: `This closes pull request #${number} without merging it.`,
      confirmLabel: "Close PR",
    });
    if (!ok) return;
    await this.runRowAction(number, "close", async () => {
      await runPinned((project) => closePr(number, project));
      await this.loadPrList(true);
    }, `Could not close PR #${number}`);
  }

  async loadMoreGraph(): Promise<void> {
    const id = this.graphLoadId;
    const skip = this.graphCommits.length;
    this.graph = { ...this.graph, loading: true };
    this.render();
    try {
      const batch = await this.fetchGraphPage(skip, false);
      if (this.graphLoadId !== id) return;
      const next = [...this.graphCommits, ...batch];
      this.graphCommits = next;
      const hasMore = batch.length === PAGE;
      const key = await activeWorktreePath();
      if (key) this.graphCache.set(key, { commits: next, hasMore });
      this.publishGraph(next, hasMore, false);
    } catch {
      if (this.graphLoadId !== id) return;
      this.publishGraph(this.graphCommits, false, false);
    }
  }

  private renderTabs(changes: number): HTMLDivElement {
    const tabs: Array<{ id: TabId; label: string; iconName: "branch" | "pr" | "history" }> = [
      { id: "branch", label: "Branch", iconName: "branch" },
      { id: "prs", label: "PRs", iconName: "pr" },
      { id: "history", label: "History", iconName: "history" },
    ];
    return h(
      "div",
      { class: "flex shrink-0 border-b border-border" },
      tabs.map((tab) =>
        h(
          "button",
          {
            type: "button",
            class: this.tab === tab.id
              ? "flex flex-1 items-center justify-center gap-1.5 border-b-2 border-primary px-2 py-2 text-[11px] font-medium text-foreground outline-none transition-colors"
              : "flex flex-1 items-center justify-center gap-1.5 border-b-2 border-transparent px-2 py-2 text-[11px] font-medium text-muted-foreground outline-none transition-colors hover:text-foreground",
            onclick: () => this.setTab(tab.id),
          },
          icon(tab.iconName, 12, "", 2.5),
          tab.label,
          tab.id === "branch" && changes > 0
            ? h(
                "span",
                { class: "rounded-full bg-muted-foreground px-1.5 py-px text-[9px] font-bold leading-none text-background" },
                String(changes),
              )
            : null,
        ),
      ),
    );
  }

  private async resolvePr(cwd: string | undefined, branch: string | null): Promise<void> {
    let pr: MuxyGitPR | null = null;
    try {
      pr = await muxy.git.pr.info({ fresh: true });
    } catch {
      return;
    }
    if (this.repo.kind !== "ready" || this.repo.status.branch !== branch) return;
    this.repo = { kind: "ready", status: { ...this.repo.status, pullRequest: pr } };
    if (cwd) this.statusCache.set(cwd, this.repo);
    this.render();
  }

  private async switchScope(): Promise<void> {
    if (isBusy()) {
      this.pendingSwitch = true;
      return;
    }
    const cwd = await activeWorktreePath();
    const cached = cwd ? this.statusCache.get(cwd) : undefined;
    if (cached) {
      this.repo = cached;
      this.render();
    } else {
      this.switching = true;
      this.render();
    }
    await this.loadLocal(true);
  }

  private reconcile(): void {
    if (this.reconcileTimer) clearTimeout(this.reconcileTimer);
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = null;
      if (isBusy()) return;
      void this.reconcileNow();
    }, 250);
  }

  private async reconcileNow(): Promise<void> {
    const id = ++this.refreshId;
    const cwd = await activeWorktreePath();
    let next: RepoState;
    let branchChanged = false;
    try {
      const status = toViewStatus(await muxy.git.status({ local: true }));
      const prev = cwd ? this.statusCache.get(cwd) : undefined;
      if (prev?.kind === "ready" && prev.status.branch === status.branch) {
        status.pullRequest = prev.status.pullRequest;
        status.defaultBranch = prev.status.defaultBranch;
      } else if (prev?.kind === "ready") branchChanged = true;
      next = { kind: "ready", status };
    } catch {
      next = { kind: "no_repo" };
    }
    if (this.refreshId !== id) return;
    if (cwd) this.statusCache.set(cwd, next);
    this.repo = next;
    this.render();
    if (branchChanged && next.kind === "ready") void this.resolvePr(cwd, next.status.branch);
  }

  private moveEntry(path: string, from: "staged" | "unstaged", to: "staged" | "unstaged"): void {
    if (this.repo.kind !== "ready") return;
    const src = this.repo.status[from];
    const entry = src.find((file) => file.path === path);
    if (!entry) return;
    const moved = to === "staged" ? { ...entry, label: entry.label === "?" ? "A" : entry.label } : entry;
    this.repo = {
      kind: "ready",
      status: {
        ...this.repo.status,
        [from]: src.filter((file) => file.path !== path),
        [to]: [...this.repo.status[to], moved].sort((a, b) => a.path.localeCompare(b.path)),
      },
    };
    this.render();
  }

  private reloadPrListOnScopeChange(): void {
    if (this.prStarted) void this.loadPrList(false);
  }

  private async runRowAction(
    number: number,
    action: RowAction,
    fn: () => Promise<void>,
    title: string,
  ): Promise<void> {
    this.prRowPending.set(number, action);
    this.render();
    try {
      await fn();
    } catch (err) {
      await alertError(title, err);
    } finally {
      this.prRowPending.delete(number);
      this.render();
    }
  }

  private publishGraph(commits: CommitNode[], hasMore: boolean, loading: boolean): void {
    this.graph = { rows: computeLanes(commits), hasMore, loading };
    this.render();
  }

  private async fetchGraphPage(skip: number, fresh: boolean): Promise<CommitNode[]> {
    const batch = await muxy.git.log({ maxCount: PAGE, skip, fresh });
    return batch.map(toCommitNode);
  }

  private async resetGraph(fresh: boolean): Promise<void> {
    const id = ++this.graphLoadId;
    const key = await activeWorktreePath();
    const cached = key ? this.graphCache.get(key) : undefined;
    if (cached) this.publishGraph(cached.commits, cached.hasMore, true);
    else {
      this.graphCommits = [];
      this.publishGraph([], false, true);
    }

    try {
      const batch = await this.fetchGraphPage(0, fresh);
      if (this.graphLoadId !== id) return;
      this.graphCommits = batch;
      const hasMore = batch.length === PAGE;
      if (key) this.graphCache.set(key, { commits: batch, hasMore });
      this.publishGraph(batch, hasMore, false);
    } catch {
      if (this.graphLoadId !== id) return;
      this.graphCommits = [];
      this.publishGraph([], false, false);
    }
  }
}
