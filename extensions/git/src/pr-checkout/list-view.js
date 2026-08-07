import { clear, h } from "@/lib/dom";
import { icon } from "@/lib/icons";
import { checksLabel, filterPullRequests, selectionMode } from "@/pr-checkout/model";
import { footer, heading, message, refreshBar } from "@/pr-checkout/ui";

export class PrListView {
    root;
    prs = [];
    visible = [];
    selected = 0;
    query = "";
    loading = true;
    refreshing = false;
    error = "";
    search;
    counter;
    results;
    footerLabel;
    onDetails;
    onCheckout;
    onRetry;
    constructor(root, { onDetails, onCheckout, onRetry }) {
        this.root = root;
        this.onDetails = onDetails;
        this.onCheckout = onCheckout;
        this.onRetry = onRetry;
    }
    update({ prs = this.prs, loading = false, refreshing = false, error = "" }) {
        const selectedNumber = this.visible[this.selected]?.number;
        this.prs = prs;
        this.visible = filterPullRequests(prs, this.query);
        this.selected = Math.max(0, this.visible.findIndex((pr) => pr.number === selectedNumber));
        this.loading = loading;
        this.refreshing = refreshing;
        this.error = error;
        this.render();
    }
    render() {
        this.search = h("input", {
            type: "search",
            class: "pr-search",
            placeholder: this.loading ? "Loading open pull requests…" : "Search titles, branches, authors, or numbers…",
            value: this.query,
            autocomplete: "off",
            autofocus: "",
            disabled: this.loading || this.refreshing,
            "aria-label": "Search pull requests",
            "aria-controls": "pr-results",
            oninput: () => this.filter(),
        });
        this.counter = h("span", { class: "pr-counter", "aria-hidden": "true" });
        this.results = h("div", { id: "pr-results", class: "pr-results", role: "listbox" });
        const shell = h("main", { class: `pr-modal${this.refreshing ? " pr-is-refreshing" : ""}` }, refreshBar(this.refreshing, "Refreshing pull requests"), heading("Pull requests", "Search open pull requests in the current repository"), h("div", { class: "pr-search-wrap" }, icon("search", 12, "pr-search-icon", 2), this.search, this.counter), this.results, footer(this.footerText(), [["↑↓", "Navigate"], ["↵", "Open"], ["⇧ ↵", "Checkout"], ["⌘R", "Reload"], ["esc", "Close"]]));
        clear(this.root);
        this.root.appendChild(shell);
        this.footerLabel = shell.querySelector(".pr-footer-label");
        this.renderResults();
        if (!this.loading && !this.refreshing)
            this.search.focus();
    }
    footerText() {
        if (this.loading)
            return "Loading pull requests…";
        if (this.refreshing)
            return "Refreshing pull requests…";
        if (this.error)
            return `Refresh failed: ${this.error}`;
        return `${this.visible.length} open pull request${this.visible.length === 1 ? "" : "s"}`;
    }
    filter() {
        this.query = this.search.value;
        this.visible = filterPullRequests(this.prs, this.query);
        this.selected = 0;
        this.renderResults();
    }
    renderResults() {
        clear(this.results);
        this.counter.textContent = "";
        this.footerLabel.textContent = this.footerText();
        if (this.loading) {
            this.results.appendChild(message("Loading open pull requests…", "loader"));
            return;
        }
        if (this.error && this.prs.length === 0) {
            this.results.appendChild(message(this.error || "Could not load pull requests.", "refresh", this.onRetry));
            return;
        }
        if (this.visible.length === 0) {
            this.results.appendChild(message(this.prs.length === 0 ? "No open pull requests." : "No pull requests match this search.", "pr"));
            return;
        }
        for (const [index, pr] of this.visible.entries())
            this.results.appendChild(this.renderRow(pr, index));
        this.syncSelection(false);
    }
    renderRow(pr, index) {
        const label = checksLabel(pr.checks);
        const tone = pr.checks?.status === "failure"
            ? "pr-checks-failure"
            : pr.checks?.status === "pending"
                ? "pr-checks-pending"
                : "pr-checks-success";
        return h("div", {
            id: `pr-option-${pr.number}`,
            class: `pr-row${pr.isDraft ? " pr-row-draft" : ""}${index === this.visible.length - 1 ? " pr-row-last" : ""}`,
            role: "option",
            "aria-selected": false,
            "data-index": index,
            tabindex: index === this.selected ? 0 : -1,
            onmouseenter: () => this.setSelected(index),
            onclick: () => {
                this.setSelected(index);
                this.onDetails(pr);
            },
        }, h("span", { class: "pr-state" }, icon(pr.isDraft ? "circleDashed" : "pr", 13, "", 2)), h("span", { class: "pr-copy" }, h("span", { class: "pr-title" }, pr.title || `Pull request #${pr.number}`), h("span", { class: "pr-meta" }, h("span", {}, `#${pr.number}`), h("span", {}, pr.author || "Unknown author"), h("span", {}, pr.headBranch || "unknown"), h("span", { class: "pr-arrow" }, "→"), h("span", {}, pr.baseBranch || "default"))), label ? h("span", { class: `pr-checks ${tone}` }, icon(pr.checks?.status === "pending" ? "loader" : pr.checks?.status === "failure" ? "xCircle" : "check", 11, pr.checks?.status === "pending" ? "pr-spinner" : "", 2), label) : null);
    }
    handleKey(event) {
        if (this.loading || this.refreshing || this.visible.length === 0)
            return false;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            const offset = event.key === "ArrowDown" ? 1 : -1;
            this.setSelected((this.selected + offset + this.visible.length) % this.visible.length, this.results.contains(document.activeElement));
            return true;
        }
        const mode = selectionMode(event);
        const pr = this.visible[this.selected];
        if (mode === "details") {
            this.onDetails(pr);
            return true;
        }
        if (mode === "checkout") {
            this.onCheckout(pr);
            return true;
        }
        return false;
    }
    setSelected(index, focus = false) {
        if (index === this.selected)
            return;
        this.selected = index;
        this.syncSelection(true, focus);
    }
    syncSelection(scroll, focus = false) {
        const rows = this.results.querySelectorAll(".pr-row");
        for (const row of rows) {
            const active = Number(row.dataset.index) === this.selected;
            row.classList.toggle("pr-row-selected", active);
            row.setAttribute("aria-selected", String(active));
            row.tabIndex = active ? 0 : -1;
            if (active && scroll)
                row.scrollIntoView({ block: "nearest" });
            if (active && focus)
                row.focus();
        }
        const pr = this.visible[this.selected];
        this.counter.textContent = `${this.selected + 1} / ${this.visible.length}`;
        this.search.setAttribute("aria-activedescendant", pr ? `pr-option-${pr.number}` : "");
    }
}
