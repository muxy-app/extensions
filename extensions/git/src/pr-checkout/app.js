import { alertError, confirmAction, openUrl, runBusy } from "@/lib/git";
import { checkoutPrDefaultWorktree, checkoutPrWorktree, closePr, mergePr } from "@/lib/pr";
import * as scm from "@/lib/repo";
import { PrCache } from "@/pr-checkout/cache";
import { CheckoutView } from "@/pr-checkout/checkout-view";
import { DetailView } from "@/pr-checkout/detail-view";
import { PrListView } from "@/pr-checkout/list-view";
import { defaultWorktreeRoot, isBackShortcut, isPrOpen, prWorktreePath, RequestGate } from "@/pr-checkout/model";

const PR_LIMIT = 100;

async function notify(title, body) {
    try {
        await muxy.notifications.notify({ title, body });
    }
    catch {
        return;
    }
}

export class PrCheckoutApp {
    root;
    view = "list";
    listView;
    checkoutView;
    detailView;
    checkoutReturnView = "list";
    cache = new PrCache();
    selectedPr;
    scopeRoot = "";
    busy = false;
    refreshing = false;
    listRequests = new RequestGate();
    detailRequests = new RequestGate();
    constructor(root) {
        this.root = root;
        this.listView = new PrListView(root, {
            onDetails: (pr) => this.openDetails(pr),
            onCheckout: (pr) => this.openCheckout(pr),
            onRetry: () => void this.loadList(true),
        });
    }
    start() {
        window.addEventListener("keydown", (event) => this.onKeyDown(event));
        this.showList();
        void this.initialize();
    }
    async initialize() {
        const worktrees = await scm.worktreesList().catch(() => []);
        this.scopeRoot = defaultWorktreeRoot(worktrees);
        if (!this.scopeRoot) {
            const info = await scm.repoInfo().catch(() => null);
            this.scopeRoot = info?.root ?? "";
        }
        const restored = await this.cache.restore(this.scopeRoot);
        if (restored) {
            if (this.view === "list")
                this.listView.update({ prs: this.cache.list });
            return;
        }
        await this.loadList(false);
    }
    showList() {
        this.detailRequests.invalidate();
        this.view = "list";
        this.checkoutView = null;
        this.detailView = null;
        this.listView.update({
            prs: this.cache.list ?? [],
            loading: this.cache.list === null,
        });
    }
    async loadList(fresh) {
        if (!fresh && this.cache.list !== null) {
            if (this.view === "list")
                this.listView.update({ prs: this.cache.list });
            return true;
        }
        const cached = this.cache.list ?? [];
        if (this.view === "list") {
            this.listView.update({
                prs: cached,
                loading: this.cache.list === null,
                refreshing: this.cache.list !== null,
            });
        }
        const request = this.listRequests.start();
        try {
            const prs = await scm.prList({ filter: "open", limit: PR_LIMIT, fresh });
            if (!this.listRequests.allows(request))
                return false;
            void this.cache.setList(prs);
            if (this.view === "list")
                this.listView.update({ prs });
            return true;
        }
        catch (err) {
            if (!this.listRequests.allows(request))
                return false;
            const error = err instanceof Error ? err.message : String(err);
            if (this.view === "list")
                this.listView.update({ prs: cached, error });
            return false;
        }
    }
    openCheckout(pr, returnView = "list") {
        this.detailRequests.invalidate();
        this.selectedPr = pr;
        this.checkoutReturnView = returnView;
        this.view = "checkout";
        this.detailView = null;
        this.checkoutView = new CheckoutView(this.root, pr, prWorktreePath(this.scopeRoot, pr.number), {
            onBack: () => this.goBack(),
            onChoose: (mode) => void this.checkout(mode),
        });
        this.checkoutView.render();
    }
    openDetails(pr) {
        this.detailRequests.invalidate();
        this.selectedPr = pr;
        this.view = "details";
        this.checkoutView = null;
        this.detailView = new DetailView(this.root, pr, {
            onBack: () => this.goBack(),
            onRetry: () => void this.loadDetails(true),
            onAction: (action) => void this.runPrAction(action),
        });
        const cached = this.cache.getDetails(pr.number);
        if (cached)
            this.detailView.setReady(cached);
        else {
            this.detailView.setLoading(false);
            void this.loadDetails(false);
        }
    }
    async loadDetails(fresh) {
        const number = this.selectedPr?.number;
        if (!number)
            return false;
        const cached = this.cache.getDetails(number);
        if (!fresh && cached) {
            this.detailView?.setReady(cached);
            return true;
        }
        const request = this.detailRequests.start();
        this.detailView?.setLoading(!!cached);
        try {
            const detail = await scm.prDetails(number);
            if (!this.detailRequests.allows(request))
                return false;
            this.cache.setDetails(number, detail);
            this.updateCachedPr(detail);
            if (this.view === "details" && this.selectedPr?.number === number)
                this.detailView?.setReady(detail);
            return true;
        }
        catch (err) {
            if (!this.detailRequests.allows(request))
                return false;
            const error = err instanceof Error ? err.message : String(err);
            if (this.view === "details" && this.selectedPr?.number === number)
                this.detailView?.setError(error);
            return false;
        }
    }
    updateCachedPr(detail) {
        if (!this.cache.list)
            return;
        void this.cache.updateListItem(detail);
        if (this.selectedPr?.number === detail.number)
            this.selectedPr = this.cache.list.find((pr) => pr.number === detail.number) ?? this.selectedPr;
    }
    goBack() {
        if (this.busy)
            return;
        if (this.view === "checkout" && this.checkoutReturnView === "details" && this.selectedPr) {
            this.openDetails(this.selectedPr);
            return;
        }
        this.showList();
    }
    onKeyDown(event) {
        if (event.metaKey && event.key.toLowerCase() === "r") {
            event.preventDefault();
            if (!this.busy && !this.refreshing)
                void this.refreshCurrent();
            return;
        }
        if (this.view !== "list" && (event.key === "Escape" || isBackShortcut(event))) {
            event.preventDefault();
            this.goBack();
            return;
        }
        const handled = this.view === "list"
            ? this.listView.handleKey(event)
            : this.view === "checkout"
                ? this.checkoutView?.handleKey(event)
                : this.detailView?.handleKey(event);
        if (handled)
            event.preventDefault();
    }
    async refreshCurrent() {
        if (this.refreshing)
            return;
        this.refreshing = true;
        try {
            if (this.view === "list") {
                await this.loadList(true);
                return;
            }
            if (this.view === "details") {
                await this.loadDetails(true);
                return;
            }
            const number = this.selectedPr?.number;
            this.checkoutView?.setBusy(true, `Refreshing PR #${number}…`);
            const loaded = await this.loadList(true);
            const pr = this.cache.list?.find((item) => item.number === number) ?? this.selectedPr;
            if (loaded && pr)
                this.openCheckout(pr, this.checkoutReturnView);
            else
                this.checkoutView?.setBusy(false);
        }
        finally {
            this.refreshing = false;
        }
    }
    async checkout(mode) {
        if (this.busy || !this.selectedPr)
            return;
        const pr = this.selectedPr;
        const worktree = mode === "worktree";
        const path = worktree ? prWorktreePath(this.scopeRoot, pr.number) : "";
        this.busy = true;
        this.checkoutView?.setBusy(true, worktree ? `Creating worktree for PR #${pr.number}…` : `Checking out PR #${pr.number} in the default worktree…`);
        try {
            await runBusy(async () => {
                if (worktree)
                    return checkoutPrWorktree(pr.number, path);
                await checkoutPrDefaultWorktree(pr.number, this.scopeRoot);
                await muxy.worktrees.refresh().catch(() => undefined);
            });
            await notify(worktree ? "Pull request worktree created" : "Pull request checked out", worktree ? `${path} is ready.` : `PR #${pr.number} is checked out in the default worktree.`);
            muxy.lifecycle.close();
        }
        catch (err) {
            await alertError(worktree ? `Could not create worktree for PR #${pr.number}` : `Could not checkout PR #${pr.number}`, err);
        }
        finally {
            this.busy = false;
            if (this.view === "checkout")
                this.checkoutView?.setBusy(false);
        }
    }
    async runPrAction(action) {
        if (this.busy || !this.selectedPr)
            return;
        const pr = this.selectedPr;
        if (action === "open") {
            openUrl(this.detailView?.detail?.url || pr.url);
            return;
        }
        if (!isPrOpen(this.detailView?.detail ?? pr))
            return;
        if (action === "checkout") {
            this.openCheckout(this.detailView?.detail ?? pr, "details");
            return;
        }
        const merge = action === "merge";
        const confirmed = await confirmAction({
            title: merge ? `Merge PR #${pr.number}?` : `Close PR #${pr.number}?`,
            message: merge ? `Merge “${pr.title}” into ${pr.baseBranch || "its base branch"}?` : `Close “${pr.title}” without merging it?`,
            confirmLabel: merge ? "Merge PR" : "Close PR",
            critical: !merge,
        });
        if (!confirmed)
            return;
        if (!isPrOpen(this.detailView?.detail ?? this.selectedPr ?? pr))
            return;
        this.busy = true;
        this.detailView?.setBusy(true, merge ? `Merging PR #${pr.number}…` : `Closing PR #${pr.number}…`);
        try {
            await runBusy(() => merge ? mergePr(pr.number, "merge", false) : closePr(pr.number));
            this.cache.deleteDetails(pr.number);
            await this.cache.deleteListItem(pr.number);
            await notify(merge ? "Pull request merged" : "Pull request closed", `PR #${pr.number} · ${pr.title}`);
            this.showList();
            await this.loadList(true);
        }
        catch (err) {
            await alertError(merge ? `Could not merge PR #${pr.number}` : `Could not close PR #${pr.number}`, err);
        }
        finally {
            this.busy = false;
            if (this.view === "details")
                this.detailView?.setBusy(false);
        }
    }
}
