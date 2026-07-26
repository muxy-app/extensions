import { branchNameFromTitle } from "@/lib/pr";
import { cls, h, readPref, writePref } from "@/lib/dom";
import { activeWorktreePath, confirmAction, listBranches, openDiff } from "@/lib/git";
import { openInEditor, revealInFinder } from "@/lib/file-actions";
import { icon } from "@/lib/icons";
import { button, closeFloating, fileRow, iconButton, menuItem, openFloating, smallIconButton, textarea, } from "@/ui/shared";
import { treeIndent, treeRows } from "@/ui/file-tree";
const SECTION_PREFIX = "muxy.git.section.";
const TREE_PREFIX = "muxy.git.tree.";
const VIEW_KEY = "muxy.git.changes.view";
async function openFileInEditor(path) {
    await openInEditor(await activeWorktreePath(), path);
}
async function revealFileInFinder(path) {
    await revealInFinder(await activeWorktreePath(), path);
}
function fileActionHandlers(entry) {
    if (entry.label === "D")
        return {};
    return {
        onOpenEditor: (path) => void openFileInEditor(path),
        onReveal: (path) => void revealFileInFinder(path),
    };
}
function changesView() {
    return readPref(VIEW_KEY, "tree") === "list" ? "list" : "tree";
}
function toggleChangesView(app) {
    writePref(VIEW_KEY, changesView() === "tree" ? "list" : "tree");
    app.render();
}
export function renderBranchSwitcher(app, status) {
    return h("button", {
        type: "button",
        class: "flex h-8 w-full items-center gap-1.5 px-2.5 text-[12px] text-foreground outline-none hover:bg-accent",
        onclick: (event) => openBranchMenu(app, event.currentTarget),
    }, icon("branch", 13, "text-muted-foreground", 2), h("span", { class: "truncate font-medium" }, status.branch ?? "No branch"), status.ahead > 0 || status.behind > 0
        ? h("span", { class: "flex shrink-0 items-center gap-1 font-mono text-[10px] text-muted-foreground" }, status.behind > 0
            ? h("span", { class: "flex items-center" }, icon("arrowDown", 10, "", 2.5), String(status.behind))
            : null, status.ahead > 0
            ? h("span", { class: "flex items-center" }, icon("arrowUp", 10, "", 2.5), String(status.ahead))
            : null)
        : null, icon("chevronDown", 12, "ml-auto text-muted-foreground", 2.5));
}
const OP_LABELS = { revert: "Reverting", "cherry-pick": "Cherry-picking", merge: "Merging", rebase: "Rebasing" };
function renderPendingOpBanner(app, status) {
    const op = status.pendingOp;
    return h("div", { class: "flex items-center gap-2 border-b border-border bg-secondary px-2.5 py-2" }, icon("history", 14, "text-muted-foreground", 2.5), h("div", { class: "flex min-w-0 flex-1 flex-col" }, h("span", { class: "text-[12px] font-semibold text-foreground" }, `${OP_LABELS[op] ?? "Operation"} in progress`), h("span", { class: "text-[10px] text-muted-foreground" }, "Commit to finish, or abort.")), button("Abort", {
        iconName: "undo",
        variant: "outline",
        size: "md",
        loading: app.opPending,
        disabled: app.opPending,
        onClick: () => void confirmAbort(app, op),
    }));
}
async function confirmAbort(app, op) {
    const ok = await confirmAction({
        title: `Abort ${op}?`,
        message: `This aborts the in-progress ${op} and restores your branch to its state before it started.`,
        confirmLabel: "Abort",
        critical: true,
    });
    if (ok)
        void app.abortPendingOp(op);
}
export function renderBranchTab(app, status) {
    if (status.unstaged.length === 0)
        app.resetChangesFilter();
    const fragment = document.createDocumentFragment();
    if (status.pendingOp)
        fragment.appendChild(renderPendingOpBanner(app, status));
    fragment.appendChild(h("section", { class: "flex flex-col gap-2 border-b border-border p-2.5" }, renderCommitBox(app, status)));
    const clean = status.staged.length === 0 && status.unstaged.length === 0;
    fragment.appendChild(h("main", { class: "flex min-h-0 flex-1 flex-col overflow-auto" }, renderFileSection(app, {
        id: "staged",
        title: "Staged Changes",
        entries: status.staged,
        staged: true,
        bulkLabel: "Unstage all",
        onBulk: () => void app.unstageAll(),
        onAction: (path) => void app.unstage(path),
    }), renderFileSection(app, {
        id: "changes",
        title: "Changes",
        entries: status.unstaged,
        staged: false,
        searchable: true,
        bulkLabel: "Stage all",
        onBulk: () => void app.stageAll(),
        onAction: (path) => void app.stage(path),
        onDiscard: (path) => void discardOne(app, path),
        onBulkDiscard: () => void discardAll(app, status.unstaged.length),
    }), clean ? h("div", { class: "flex flex-col items-center gap-3 px-4 py-7 text-center text-muted-foreground" }, "No changes.") : null));
    return fragment;
}
function renderCommitBox(app, status) {
    const canCommit = status.staged.length > 0;
    const isCommitDisabled = () => !canCommit || app.message.trim() === "" || app.commitBusy !== null;
    let primary;
    const sync = () => {
        const disabled = isCommitDisabled();
        primary.disabled = disabled;
        primary.className = cls("flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium outline-none transition-colors disabled:pointer-events-none disabled:opacity-50", disabled
            ? "bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground"
            : "bg-primary text-primary-foreground hover:opacity-95");
    };
    const area = textarea(app.message, "Commit message (Cmd+Enter to commit on branch)", 1, (value) => {
        app.setMessage(value);
        sync();
    }, "min-h-[48px]", "commit-message");
    area.addEventListener("keydown", (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void commit(app);
        }
    });
    return h("div", { class: "flex flex-col gap-2" }, area, h("div", { class: "flex items-center gap-1" }, (primary = button("Commit", {
        iconName: "check",
        loading: app.commitBusy === "commit",
        variant: isCommitDisabled() ? "secondary" : "default",
        disabled: isCommitDisabled(),
        className: "flex-1",
        onClick: () => void commit(app),
    })), renderSyncButton(app, "pull"), renderSyncButton(app, "push")));
}

function renderSyncButton(app, op) {
    const pull = op === "pull";
    return iconButton(pull ? "Pull" : "Push", pull ? "arrowDown" : "arrowUp", () => void runSync(app, op), "bg-secondary", app.commitBusy !== null, "default", "md");
}
async function commit(app) {
    if (app.commitBusy || app.message.trim() === "")
        return;
    app.commitBusy = "commit";
    app.render();
    try {
        if (await app.commit(app.message.trim())) {
            app.message = "";
            app.render();
        }
    }
    finally {
        app.commitBusy = null;
        app.render();
    }
}
async function runSync(app, op) {
    if (app.commitBusy)
        return;
    app.commitBusy = op;
    app.render();
    try {
        await app.sync(op);
    }
    finally {
        app.commitBusy = null;
        app.render();
    }
}
function renderSectionHeader(app, opts, open, toggle) {
    const filterOpen = opts.searchable && app.changesFilterOpen;
    const title = h("button", {
        type: "button",
        class: "flex min-w-0 items-center gap-1.5 text-muted-foreground hover:text-foreground",
        onclick: toggle,
    }, h("span", { class: "flex w-4 shrink-0 justify-center" }, icon("chevronDown", 12, cls("transition-transform", !open && "-rotate-90"), 2.2)), h("span", { class: "truncate text-[12px] font-semibold" }, opts.title));
    const count = h("span", { class: "ml-1.5 rounded-full bg-muted-foreground px-1.5 py-px text-[10px] font-bold leading-none text-background" }, String(opts.entries.length));
    const tree = changesView() === "tree";
    const actions = h("div", { class: "ml-auto flex items-center text-muted-foreground" }, smallIconButton(tree ? "List view" : "Tree view", tree ? "list" : "listTree", () => toggleChangesView(app), "opacity-0 group-hover:opacity-100"), opts.searchable
        ? smallIconButton(filterOpen ? "Hide search" : "Search files", filterOpen ? "x" : "search", () => app.toggleChangesFilter(), filterOpen ? "text-foreground" : "opacity-0 group-hover:opacity-100")
        : null, h("div", { class: "flex items-center opacity-0 group-hover:opacity-100" }, opts.onBulkDiscard
        ? smallIconButton("Discard all changes", "undo", () => opts.onBulkDiscard?.())
        : null, smallIconButton(opts.bulkLabel, opts.staged ? "minus" : "plus", () => opts.onBulk())));
    return h("header", { class: "group sticky top-0 z-10 flex h-[26px] shrink-0 items-center bg-background pl-2 pr-2" }, title, count, actions);
}
function renderSearchBar(app) {
    const field = h("input", {
        value: app.changesFilter,
        placeholder: "Filter changed files...",
        spellcheck: "false",
        autocorrect: "off",
        autocapitalize: "off",
        autocomplete: "off",
        "data-focus-key": "changes-filter",
        class: "h-6 w-full rounded border border-input bg-secondary pl-2 pr-6 text-[11px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary",
        oninput: (event) => {
            app.setChangesFilter(event.target.value);
            app.render();
        },
        onkeydown: (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                app.toggleChangesFilter();
            }
        },
    });
    setTimeout(() => {
        if (!document.hasFocus())
            return;
        if (document.activeElement?.getAttribute("data-focus-key") !== "changes-filter")
            field.focus();
    }, 0);
    return h("div", { class: "relative shrink-0 px-2 pb-1.5" }, field, app.changesFilter
        ? smallIconButton("Clear filter", "x", () => {
            app.setChangesFilter("");
            app.render();
        }, "absolute right-3 top-1/2 -translate-y-1/2")
        : null);
}
function renderFileList(app, entries, opts) {
    if (entries.length === 0)
        return h("div", { class: "px-4 py-4 text-center text-[12px] text-muted-foreground" }, "No matching files.");
    if (changesView() === "tree") {
        return h("ul", { class: "divide-y divide-transparent" }, treeRows(entries, {
            prefix: `${TREE_PREFIX}${opts.id}.`,
            onToggle: () => app.render(),
            renderLeaf: (file, depth) => fileRow(file, {
                staged: opts.staged,
                indent: treeIndent(depth),
                name: file.name,
                onAction: opts.onAction,
                onDiscard: opts.onDiscard,
                onOpen: openDiff,
                ...fileActionHandlers(file),
            }),
        }));
    }
    return h("ul", { class: "divide-y divide-border" }, entries.map((entry) => fileRow(entry, {
        staged: opts.staged,
        onAction: opts.onAction,
        onDiscard: opts.onDiscard,
        onOpen: openDiff,
        ...fileActionHandlers(entry),
    })));
}
function filterEntries(app, opts) {
    if (!opts.searchable || !app.changesFilterOpen)
        return opts.entries;
    const term = app.changesFilter.trim().toLowerCase();
    if (!term)
        return opts.entries;
    return opts.entries.filter((entry) => entry.path.toLowerCase().includes(term));
}
function renderFileSection(app, opts) {
    if (opts.entries.length === 0)
        return null;
    const key = `${SECTION_PREFIX}${opts.id}`;
    const open = readPref(key, "true") !== "false";
    const toggle = () => {
        writePref(key, open ? "false" : "true");
        app.render();
    };
    const searchOpen = opts.searchable && app.changesFilterOpen;
    return h("section", { class: "flex shrink-0 flex-col" }, renderSectionHeader(app, opts, open, toggle), open && searchOpen ? renderSearchBar(app) : null, open ? renderFileList(app, filterEntries(app, opts), opts) : null);
}
async function discardOne(app, path) {
    const ok = await confirmAction({
        title: "Discard changes",
        message: `Are you sure you want to discard changes in ${path}? This cannot be undone.`,
        confirmLabel: "Discard",
        critical: true,
    });
    if (ok)
        void app.discard(path);
}
async function discardAll(app, count) {
    const ok = await confirmAction({
        title: "Discard all changes",
        message: `Are you sure you want to discard all ${count} changes? This cannot be undone.`,
        confirmLabel: "Discard All",
        critical: true,
    });
    if (ok)
        void app.discardAll();
}
function openBranchMenu(app, anchor) {
    const list = h("div", { class: "max-h-72 min-h-[9rem] overflow-auto p-1" });
    const search = h("input", {
        class: "h-8 w-full border-b border-border bg-transparent px-2 text-[12px] text-foreground outline-none placeholder:text-muted-foreground",
        placeholder: "Switch or create branch...",
        autocorrect: "off",
        autocapitalize: "off",
        autocomplete: "off",
        spellcheck: "false",
    });
    const content = h("div", { class: "text-popover-foreground" }, search, list);
    const close = openFloating(anchor, content, { width: 256, align: "start" });
    let branches = [];
    let current = null;
    const render = () => {
        list.replaceChildren();
        const term = search.value.trim();
        const visible = term
            ? branches.filter((name) => name.toLowerCase().includes(term.toLowerCase()))
            : branches;
        if (term && !branches.includes(term)) {
            list.appendChild(menuItem(`Create branch "${term}"`, "plus", () => {
                close();
                void app.switchBranch(term, true);
            }));
        }
        if (visible.length === 0 && !term) {
            list.appendChild(h("div", { class: "px-2 py-6 text-center text-[12px] text-muted-foreground" }, "No branches"));
        }
        for (const name of visible) {
            const active = name === current;
            const row = h("button", {
                type: "button",
                class: cls("group flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[12px] outline-none hover:bg-accent", active ? "font-semibold text-primary" : "text-foreground"),
                onclick: () => {
                    if (active)
                        return;
                    close();
                    void app.switchBranch(name, false);
                },
            }, h("span", { class: "flex min-w-0 items-center gap-2" }, active ? icon("check", 13, "text-primary", 2) : icon("branch", 13, "text-muted-foreground", 2), h("span", { class: "truncate" }, name)), active
                ? null
                : smallIconButton("Delete branch", "trash", (event) => {
                    event.stopPropagation();
                    void app.deleteBranch(name).then((ok) => {
                        if (!ok)
                            return;
                        branches = branches.filter((branch) => branch !== name);
                        render();
                    });
                }, "opacity-0 group-hover:opacity-100 hover:text-diff-remove"));
            list.appendChild(row);
        }
    };
    search.addEventListener("input", render);
    search.addEventListener("keydown", (event) => {
        if (event.key !== "Enter")
            return;
        const term = search.value.trim();
        if (!term)
            return;
        const exact = branches.find((name) => name === term);
        close();
        void app.switchBranch(exact ?? term, !exact);
    });
    setTimeout(() => search.focus(), 0);
    void listBranches().then((result) => {
        current = result.current;
        branches = result.branches;
        render();
    });
}
export function updateCreateTitle(app, value, branchInput) {
    app.createForm.title = value;
    if (!app.createForm.branchEdited) {
        app.createForm.newBranch = value.trim() ? branchNameFromTitle(value) : "";
        if (branchInput)
            branchInput.value = app.createForm.newBranch;
    }
}
