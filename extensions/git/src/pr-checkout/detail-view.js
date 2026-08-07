import { clear, h } from "@/lib/dom";
import { openUrl } from "@/lib/git";
import { icon } from "@/lib/icons";
import { markdownBlock } from "@/pr-checkout/markdown";
import { detailAction, isPrOpen } from "@/pr-checkout/model";
import { footer, heading, message, refreshBar } from "@/pr-checkout/ui";

const ACTIONS = [
    { id: "open", icon: "external", title: "Open in browser", description: "View this pull request on its forge.", shortcut: "⇧↵" },
    { id: "merge", icon: "merge", title: "Merge pull request", description: "Merge this branch into its base branch.", shortcut: "⌘↵" },
    { id: "close", icon: "prClosed", title: "Close pull request", description: "Close it without merging any changes.", shortcut: "⌘⌫" },
];

function dateLabel(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.valueOf()))
        return "";
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function stat(label, value, tone = "") {
    return h("span", { class: `pr-detail-stat ${tone}` }, h("strong", {}, value), h("span", {}, label));
}

function skeleton() {
    return h("div", { class: "pr-detail-skeleton", "aria-label": "Loading pull request details" }, h("span", { class: "pr-skeleton-title" }), h("span", { class: "pr-skeleton-meta" }), h("div", { class: "pr-skeleton-ledger" }, h("span", {}), h("span", {}), h("span", {}), h("span", {})), h("span", { class: "pr-skeleton-line" }), h("span", { class: "pr-skeleton-line pr-skeleton-line-short" }));
}

function stateBadge(detail) {
    const state = String(detail.state ?? "open").toLowerCase();
    if (detail.isDraft && state === "open")
        return { icon: "circleDashed", label: "Draft", tone: "draft" };
    if (state === "merged")
        return { icon: "merge", label: "Merged", tone: "merged" };
    if (state === "closed")
        return { icon: "prClosed", label: "Closed", tone: "closed" };
    return { icon: "pr", label: "Open", tone: "open" };
}

export class DetailView {
    root;
    pr;
    detail;
    loading = true;
    refreshing = false;
    error = "";
    busy = false;
    busyLabel = "";
    onBack;
    onRetry;
    onAction;
    constructor(root, pr, { onBack, onRetry, onAction }) {
        this.root = root;
        this.pr = pr;
        this.onBack = onBack;
        this.onRetry = onRetry;
        this.onAction = onAction;
    }
    setLoading(refreshing = false) {
        this.loading = !refreshing;
        this.refreshing = refreshing;
        this.error = "";
        this.render();
    }
    setReady(detail) {
        this.detail = { ...this.pr, ...detail };
        this.pr = this.detail;
        this.loading = false;
        this.refreshing = false;
        this.error = "";
        this.render();
    }
    setError(error) {
        this.loading = false;
        this.refreshing = false;
        this.error = error;
        this.render();
    }
    setBusy(busy, label = "") {
        this.busy = busy;
        this.busyLabel = label;
        this.render();
    }
    render() {
        const detail = this.detail;
        const content = h("div", { class: "pr-detail-scroll" }, this.loading && !detail
            ? skeleton()
            : this.error && !detail
                ? message(this.error || "Could not load pull request details.", "refresh", this.onRetry)
                : detail
                    ? this.content(detail)
                    : null);
        const actions = detail && !this.loading ? this.actions() : null;
        const label = this.busy
            ? this.busyLabel
            : this.loading
                ? `Loading PR #${this.pr.number}…`
                : this.refreshing
                    ? `Refreshing PR #${this.pr.number}…`
                    : this.error
                        ? `Refresh failed: ${this.error}`
                        : `${detail?.comments?.length ?? 0} comment${detail?.comments?.length === 1 ? "" : "s"}`;
        const shortcuts = detail && !isPrOpen(detail)
            ? [["⇧↵", "Open"], ["⌘R", "Reload"], ["←", "Back"]]
            : [["⇧↵", "Open"], ["⌘↵", "Merge"], ["⌘⌫", "Close"], ["⌘R", "Reload"], ["←", "Back"]];
        const shell = h("main", { class: `pr-modal pr-detail${this.refreshing ? " pr-is-refreshing" : ""}${this.busy ? " pr-modal-busy" : ""}`, tabindex: -1 }, refreshBar(this.refreshing, "Refreshing pull request details"), heading(`Pull request #${this.pr.number}`, `${this.pr.headBranch || "head"} → ${this.pr.baseBranch || "base"}`, "pr", this.onBack), content, actions, footer(label, shortcuts));
        clear(this.root);
        this.root.appendChild(shell);
        shell.focus();
    }
    content(detail) {
        const comments = detail.comments ?? [];
        const badge = stateBadge(detail);
        const summary = markdownBlock(detail.summary, { baseUrl: detail.url, emptyText: "No summary was provided.", onOpen: openUrl });
        summary.classList.add("pr-detail-summary");
        return h("article", { class: "pr-detail-content" }, h("section", { class: "pr-detail-overview" }, h("div", { class: "pr-detail-kicker" }, h("span", { class: `pr-detail-state pr-detail-state-${badge.tone}` }, icon(badge.icon, 11, "", 2), badge.label), h("span", {}, `#${detail.number}`)), h("h2", {}, detail.title || `Pull request #${detail.number}`), h("p", { class: "pr-detail-byline" }, `Opened by ${detail.author || "Unknown author"}${dateLabel(detail.createdAt) ? ` · ${dateLabel(detail.createdAt)}` : ""}`), h("div", { class: "pr-detail-ledger" }, stat("files", detail.changedFiles ?? 0), stat("added", `+${detail.additions ?? 0}`, "pr-stat-add"), stat("removed", `−${detail.deletions ?? 0}`, "pr-stat-remove"), stat("comments", comments.length))), h("section", { class: "pr-detail-section" }, h("h3", {}, "Summary"), summary), h("section", { class: "pr-detail-section pr-comments" }, h("h3", {}, `Comments · ${comments.length}`), comments.length ? comments.map((comment) => this.comment(comment, detail.url)) : h("p", { class: "pr-detail-empty" }, "No comments yet.")));
    }
    comment(comment, baseUrl) {
        const initial = String(comment.author || "?").trim().charAt(0).toUpperCase() || "?";
        const body = markdownBlock(comment.body, { baseUrl, emptyText: "No comment text.", onOpen: openUrl });
        return h("div", { class: "pr-comment" }, h("span", { class: "pr-comment-avatar", "aria-hidden": "true" }, initial), h("div", { class: "pr-comment-copy" }, h("div", { class: "pr-comment-meta" }, h("strong", {}, comment.author || "Unknown author"), comment.kind === "review" ? h("span", { class: "pr-review-badge" }, comment.state || "review") : null, h("time", {}, dateLabel(comment.createdAt))), body));
    }
    actions() {
        const open = isPrOpen(this.detail);
        return h("div", { class: "pr-detail-actions", "aria-label": "Pull request actions" }, ACTIONS.map((action) => h("button", {
            type: "button",
            class: `pr-detail-action pr-detail-action-${action.id}`,
            disabled: this.busy || this.refreshing || (action.id === "open" ? !this.detail?.url : !open),
            onclick: () => this.onAction(action.id),
        }, h("span", { class: "pr-detail-action-icon" }, icon(action.icon, 13, "", 2)), h("span", { class: "pr-detail-action-copy" }, h("strong", {}, action.title), h("span", {}, action.description)), h("kbd", {}, action.shortcut))));
    }
    handleKey(event) {
        if (this.loading || this.refreshing || this.busy || !this.detail)
            return false;
        const action = detailAction(event);
        if (!action)
            return false;
        if (action !== "open" && !isPrOpen(this.detail))
            return false;
        this.onAction(action);
        return true;
    }
}
