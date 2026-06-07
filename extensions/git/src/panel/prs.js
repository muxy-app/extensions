import { cls, h } from "@/lib/dom";
import { confirmAction, openUrl } from "@/lib/git";
import { openPrDiff } from "@/lib/git";
import { branchNameFromTitle, parentDir, prState } from "@/lib/pr";
import { icon } from "@/lib/icons";
import { button, centered, iconButton, input, smallIconButton, textarea, } from "@/ui/shared";
import { chooseFolder } from "@/ui/folder-picker";
import { updateCreateTitle } from "@/panel/branch";
const FILTERS = [
    { value: "open", label: "Open" },
    { value: "merged", label: "Merged" },
    { value: "closed", label: "Closed" },
    { value: "all", label: "All" },
];
export function renderPrsTab(app, status) {
    const pr = status.pullRequest;
    const dirty = status.staged.length > 0 || status.unstaged.length > 0;
    const top = app.worktreeForm
        ? renderWorktreeForm(app)
        : pr
            ? renderCurrentPr(app, pr, status, dirty)
            : renderCreatePrForm(app, status);
    return h("div", { class: "flex min-h-0 flex-1 flex-col" }, h("section", { class: "flex flex-col gap-2 border-b border-border p-2.5" }, top), renderPrList(app));
}
function renderWorktreeForm(app) {
    const form = app.worktreeForm;
    const field = input(form.path, "Worktree path", (value) => {
        form.path = value;
    }, "font-mono", "worktree-path");
    field.addEventListener("keydown", (event) => {
        if (event.key === "Enter")
            void app.submitWorktreeForm();
    });
    return h("div", { class: "flex flex-col gap-2" }, h("div", { class: "flex items-center gap-1.5" }, icon("folderGit", 13, "text-muted-foreground", 2), h("span", { class: "text-[12px] font-semibold text-foreground" }, `Checkout PR #${form.number} to worktree`)), h("div", { class: "flex items-center gap-1" }, field, button("Browse", {
        iconName: "folderGit",
        variant: "outline",
        size: "md",
        disabled: form.busy,
        onClick: async () => {
            const picked = await chooseFolder(parentDir(form.path));
            if (picked) {
                form.path = `${picked}/pr-${form.number}`;
                app.render();
                app.root.querySelector('[data-focus-key="worktree-path"]')?.focus();
            }
        },
    })), h("div", { class: "flex items-center justify-end gap-1.5" }, button("Cancel", {
        variant: "ghost",
        disabled: form.busy,
        onClick: () => app.cancelWorktreeForm(),
    }), button("Create worktree", {
        iconName: "folderGit",
        loading: form.busy,
        disabled: form.busy || form.path.trim() === "",
        onClick: () => void app.submitWorktreeForm(),
    })));
}
function renderCreatePrForm(app, status) {
    let branchInput;
    let submit;
    const isDisabled = () => app.createForm.busy || app.createForm.title.trim() === "";
    const sync = () => {
        const disabled = isDisabled();
        submit.disabled = disabled;
        submit.className = cls(SUBMIT_CLASS, disabled
            ? "bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground"
            : "bg-primary text-primary-foreground hover:opacity-95");
    };
    const title = textarea(app.createForm.title, status.defaultBranch ? `Pull request title (-> ${status.defaultBranch})` : "Pull request title", 1, (value) => {
        updateCreateTitle(app, value, branchInput);
        sync();
    }, "min-h-[32px]", "pr-title");
    const body = textarea(app.createForm.body, "Summary (optional)", 2, (value) => {
        app.createForm.body = value;
    }, "min-h-[48px]", "pr-body");
    const advanced = app.createForm.advanced
        ? h("div", { class: "flex flex-col gap-2" }, (branchInput = input(app.createForm.newBranch, "New branch name (optional)", (value) => {
            app.createForm.branchEdited = true;
            app.createForm.newBranch = value;
        }, "font-mono", "pr-branch")), h("label", { class: "flex items-center gap-2 text-[11px] text-muted-foreground" }, h("input", {
            type: "checkbox",
            checked: app.createForm.draft,
            class: "accent-primary",
            onchange: (event) => {
                app.createForm.draft = event.target.checked;
            },
        }), "Create as draft"))
        : null;
    submit = button("Create pull request", {
        iconName: "pr",
        loading: app.createForm.busy,
        variant: isDisabled() ? "secondary" : "default",
        disabled: isDisabled(),
        onClick: () => void submitCreate(app, status),
    });
    return h("div", { class: "flex flex-col gap-2" }, title, body, h("button", {
        type: "button",
        class: "flex items-center gap-1 self-start text-[11px] text-muted-foreground outline-none hover:text-foreground",
        onclick: () => {
            app.createForm.advanced = !app.createForm.advanced;
            if (!app.createForm.newBranch && app.createForm.title.trim()) {
                app.createForm.newBranch = branchNameFromTitle(app.createForm.title);
            }
            app.render();
        },
    }, icon(app.createForm.advanced ? "chevronDown" : "chevronRight", 12, "", 2), "Advanced"), advanced, submit);
}
const SUBMIT_CLASS = "flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium outline-none transition-colors disabled:pointer-events-none disabled:opacity-50";
async function submitCreate(app, status) {
    if (app.createForm.busy || app.createForm.title.trim() === "")
        return;
    app.createForm.busy = true;
    app.render();
    try {
        const created = await app.createPullRequest({
            title: app.createForm.title.trim(),
            body: app.createForm.body.trim(),
            baseBranch: status.defaultBranch ?? undefined,
            newBranch: app.createForm.newBranch.trim() || undefined,
            draft: app.createForm.draft,
        });
        if (created)
            app.resetCreateForm();
    }
    finally {
        app.createForm.busy = false;
        app.render();
    }
}
function renderCurrentPr(app, pr, status, dirty) {
    const target = { branch: status.branch, defaultBranch: status.defaultBranch, dirty };
    const state = prState(pr);
    const busy = app.prPending !== null;
    return h("div", { class: "flex flex-col gap-2" }, h("div", { class: "flex items-center gap-1.5" }, prStateIcon(pr, 13), h("span", { class: "font-mono text-[12px] font-semibold text-foreground" }, `#${pr.number}`), h("span", { class: "text-[11px] text-muted-foreground" }, stateLabel(pr)), h("div", { class: "ml-auto flex items-center gap-0.5" }, iconButton("Refresh PR", "refresh", () => void app.refreshCurrentPr(), "", busy || app.prRefreshing), iconButton("Close PR", "xCircle", () => void confirmCloseCurrent(app, pr.number), "", busy || state !== "open", "danger"), iconButton("Clean up branch", "trash", () => void confirmCleanupCurrent(app, target), "", busy || !status.branch), iconButton("View on GitHub", "external", () => openUrl(pr.url)))), infoRow("Base", pr.baseBranch), infoRow("Mergeable", mergeableLabel(pr), mergeableTone(pr)), checksRow(pr.checks), renderMergeActions(app, pr, target));
}
function renderMergeActions(app, pr, target) {
    const state = prState(pr);
    if (state !== "open") {
        return h("span", { class: "mt-1 flex h-7 items-center justify-center rounded-md border border-border text-[11px] text-muted-foreground" }, `This PR is ${state}.`);
    }
    const blocked = mergeBlockedReason(pr);
    const merge = (method, label) => button(label, {
        iconName: "merge",
        loading: app.prPending === method,
        variant: "outline",
        disabled: !!blocked || app.prPending !== null,
        className: "w-full",
        onClick: () => void app.mergeCurrentPr(pr.number, method, target).then((ok) => ok && app.refreshAll()),
    });
    return h("div", { class: "mt-1 flex flex-col gap-1.5" }, merge("merge", "Merge commit"), merge("squash", "Squash & merge"), merge("rebase", "Rebase & merge"), blocked ? h("span", { class: "text-center text-[10px] text-muted-foreground" }, blocked) : null);
}
function renderPrList(app) {
    return h("section", { class: "flex min-h-0 flex-1 flex-col" }, h("header", { class: "flex h-[26px] shrink-0 items-center bg-background pl-2.5 pr-2" }, h("span", { class: "text-[12px] font-semibold text-muted-foreground" }, "Pull Requests"), app.prList.kind !== "idle"
        ? smallIconButton("Refresh", "refresh", () => void app.loadPrList(true), "ml-auto", app.prListRefreshing)
        : null), app.prList.kind === "idle"
        ? h("div", { class: "flex flex-1 items-center justify-center p-4" }, button("Load pull requests", {
            iconName: "pr",
            variant: "outline",
            onClick: () => void app.loadPrList(false),
        }))
        : h("div", { class: "flex min-h-0 flex-1 flex-col" }, renderFilterTabs(app), h("div", { class: "min-h-0 flex-1 overflow-y-auto" }, renderPrListBody(app))));
}
function renderFilterTabs(app) {
    return h("div", { class: "flex items-center gap-1 border-b border-border px-2 py-1.5" }, FILTERS.map((filter) => h("button", {
        type: "button",
        class: app.prFilter === filter.value
            ? "rounded bg-accent px-2 py-1 text-[11px] font-medium text-foreground outline-none transition-colors"
            : "rounded px-2 py-1 text-[11px] font-medium text-muted-foreground outline-none transition-colors hover:text-foreground",
        onclick: () => app.setPrFilter(filter.value),
    }, filter.label)));
}
function renderPrListBody(app) {
    if (app.prList.kind === "loading")
        return centered(icon("loader", 16, "animate-spin", 2), "Loading...");
    if (app.prList.kind === "error") {
        return centered(h("span", { class: "max-w-[80%] text-center" }, app.prList.message));
    }
    if (app.prList.kind !== "ready")
        return h("div");
    if (app.prList.prs.length === 0) {
        return centered(icon("pr", 20, "", 1.5), `No ${app.prFilter === "all" ? "" : app.prFilter} pull requests.`);
    }
    return h("ul", {}, app.prList.prs.map((pr) => renderPrRow(app, pr)));
}
function renderPrRow(app, pr) {
    const pending = app.prRowPending.get(pr.number) ?? null;
    const busy = pending !== null;
    const open = prState(pr) === "open";
    return h("li", { class: "group flex items-center gap-2 border-b border-border px-3 py-1.5" }, prStateIcon(pr, 13), h("div", { class: "flex min-w-0 flex-1 flex-col" }, h("div", { class: "flex items-center gap-1.5" }, h("span", { class: "font-mono text-[11px] font-semibold text-muted-foreground" }, `#${pr.number}`), h("span", { class: "truncate text-[12px] font-medium text-foreground" }, pr.title)), h("span", { class: "truncate font-mono text-[10px] text-muted-foreground" }, `${pr.author} · ${pr.headBranch} -> ${pr.baseBranch}`)), h("div", { class: "shrink-0 group-hover:hidden" }, checksBadge(pr.checks)), h("div", { class: "hidden shrink-0 items-center gap-0.5 group-hover:flex" }, iconButton("Checkout this branch", "branchPlus", () => void app.checkoutPrRow(pr.number), "", busy), iconButton("Checkout to worktree", "folderGit", () => void app.checkoutPrWorktreeRow(pr.number), "", busy), iconButton("View diff", "fileDiff", () => void openPrDiff(pr.number), "", busy), iconButton("Open on GitHub", "external", () => openUrl(pr.url), "", busy), iconButton("Close PR", "xCircle", () => void app.closePrRow(pr.number), "", busy || !open, "danger")));
}
function prStateIcon(pr, size) {
    if (pr.isDraft)
        return icon("circleDashed", size, "text-muted-foreground", 2);
    const state = prState(pr);
    if (state === "merged")
        return icon("merge", size, "text-primary", 2);
    if (state === "closed")
        return icon("prClosed", size, "text-diff-remove", 2);
    return icon("pr", size, "text-diff-add", 2);
}
function checksBadge(checks) {
    if (checks.status === "none")
        return null;
    if (checks.status === "pending")
        return badge("muted", "loader", `${checks.pending || checks.total} running`, true);
    if (checks.status === "failure")
        return badge("negative", "xCircle", `${checks.failing} failing`);
    if (checks.status === "success")
        return badge("positive", "check", `${checks.passing} passing`);
    return badge("muted", "pr", `${checks.total} checks`);
}
function badge(tone, iconName, label, spin = false) {
    const color = tone === "positive" ? "text-diff-add" : tone === "negative" ? "text-diff-remove" : "text-muted-foreground";
    return h("span", { class: `flex items-center gap-1 text-[10px] font-medium ${color}` }, icon(iconName, 11, spin ? "animate-spin" : "", 2), label);
}
function infoRow(label, value, tone = "default") {
    const color = tone === "positive"
        ? "text-diff-add"
        : tone === "negative"
            ? "text-diff-remove"
            : tone === "muted"
                ? "text-muted-foreground"
                : "text-foreground";
    return h("div", { class: "flex items-center gap-2" }, h("span", { class: "w-[68px] shrink-0 text-[11px] text-muted-foreground" }, label), h("span", { class: `truncate font-mono text-[11px] font-medium ${color}` }, value));
}
function checksRow(checks) {
    if (checks.status === "none" && checks.total === 0)
        return infoRow("Checks", "-");
    const parts = [
        checks.passing > 0 ? `${checks.passing} passing` : "",
        checks.failing > 0 ? `${checks.failing} failing` : "",
        checks.pending > 0 ? `${checks.pending} running` : "",
    ].filter(Boolean);
    const tone = checks.failing > 0 ? "negative" : checks.pending > 0 ? "default" : checks.passing > 0 ? "positive" : "default";
    return infoRow("Checks", parts.join(" · ") || "-", tone);
}
function stateLabel(pr) {
    const state = prState(pr);
    if (state === "open")
        return pr.isDraft ? "Draft · Open" : "Open";
    if (state === "merged")
        return "Merged";
    return "Closed";
}
function mergeableLabel(pr) {
    if (pr.mergeable === false)
        return "Conflicts";
    switch (pr.mergeStateStatus) {
        case "DIRTY":
            return "Conflicts";
        case "BEHIND":
            return "Behind base";
        case "BLOCKED":
            return "Blocked";
        case "DRAFT":
            return "Draft";
        default:
            break;
    }
    if (pr.checks.failing > 0)
        return "Yes (checks failing)";
    if (pr.checks.pending > 0)
        return "Yes (checks running)";
    return "Yes";
}
function mergeableTone(pr) {
    if (pr.mergeable === false)
        return "negative";
    switch (pr.mergeStateStatus) {
        case "DIRTY":
        case "BEHIND":
        case "BLOCKED":
            return "negative";
        case "DRAFT":
            return "muted";
        default:
            break;
    }
    if (pr.checks.failing > 0)
        return "negative";
    return "positive";
}
function mergeBlockedReason(pr) {
    if (pr.isDraft)
        return "Draft PRs can't be merged.";
    if (pr.mergeable === false || pr.mergeStateStatus === "DIRTY")
        return "Has merge conflicts.";
    if (pr.mergeStateStatus === "BLOCKED")
        return "Merge is blocked by branch rules.";
    if (pr.mergeStateStatus === "BEHIND")
        return "Branch is behind the base.";
    return null;
}
async function confirmCloseCurrent(app, number) {
    const ok = await confirmAction({
        title: `Close PR #${number}?`,
        message: `This closes pull request #${number} without merging it.`,
        confirmLabel: "Close PR",
    });
    if (ok)
        void app.closeCurrentPr(number).then((done) => done && app.refreshAll());
}
async function confirmCleanupCurrent(app, target) {
    const ok = await confirmAction({
        title: `Clean up branch "${target.branch}"?`,
        message: `This switches to ${target.defaultBranch ?? "the default branch"} and deletes branch "${target.branch ?? ""}".${target.dirty ? " Uncommitted changes will no longer belong to any branch." : ""}`,
        confirmLabel: "Clean Up",
        critical: target.dirty,
    });
    if (ok)
        void app.cleanupCurrentBranch(target).then((done) => done && app.refreshAll());
}
