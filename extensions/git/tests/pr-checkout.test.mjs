import assert from "node:assert/strict";
import test from "node:test";

import { diffStats } from "../src/lib/diff-stats.js";
import { PrCache, prListCacheKey } from "../src/pr-checkout/cache.js";
import { markdownHtml, resolveMarkdownUrl } from "../src/pr-checkout/markdown.js";
import { checksLabel, defaultWorktreeRoot, detailAction, filterPullRequests, isBackShortcut, isPrOpen, isTextInputTarget, prWorktreePath, RequestGate, selectionMode } from "../src/pr-checkout/model.js";

const prs = [
    {
        number: 42,
        title: "Keep panes mounted",
        author: "maplezk",
        headBranch: "fix/pane-switch",
        baseBranch: "main",
    },
    {
        number: 73,
        title: "Improve remote terminals",
        author: "hlouis",
        headBranch: "remote/terminal",
        baseBranch: "develop",
    },
];

test("filters pull requests across titles, numbers, authors, and branches", () => {
    assert.deepEqual(filterPullRequests(prs, "panes"), [prs[0]]);
    assert.deepEqual(filterPullRequests(prs, "73"), [prs[1]]);
    assert.deepEqual(filterPullRequests(prs, "hlouis develop"), [prs[1]]);
    assert.deepEqual(filterPullRequests(prs, "REMOTE terminal"), [prs[1]]);
    assert.deepEqual(filterPullRequests(prs, ""), prs);
});

test("maps Enter and Shift+Enter to list actions", () => {
    assert.equal(selectionMode({ key: "Enter", shiftKey: false }), "details");
    assert.equal(selectionMode({ key: "Enter", shiftKey: true }), "checkout");
    assert.equal(selectionMode({ key: "ArrowRight" }), null);
    assert.equal(selectionMode({ key: "ArrowDown", shiftKey: false }), null);
});

test("maps detail shortcuts without arrow selection", () => {
    assert.equal(detailAction({ key: "Enter", shiftKey: false, metaKey: false, ctrlKey: false, altKey: false }), "checkout");
    assert.equal(detailAction({ key: "Enter", shiftKey: true }), "open");
    assert.equal(detailAction({ key: "o", metaKey: true }), null);
    assert.equal(detailAction({ key: "Enter", metaKey: true }), "merge");
    assert.equal(detailAction({ key: "Backspace", metaKey: true }), "close");
    assert.equal(detailAction({ key: "Delete", metaKey: true }), "close");
    assert.equal(detailAction({ key: "Enter", ctrlKey: true }), null);
    assert.equal(detailAction({ key: "ArrowRight", metaKey: false }), null);
});

test("maps Left Arrow to back outside text inputs", () => {
    assert.equal(isBackShortcut({ key: "ArrowLeft", target: { tagName: "DIV" } }), true);
    assert.equal(isBackShortcut({ key: "ArrowLeft", target: { tagName: "INPUT" } }), false);
    assert.equal(isBackShortcut({ key: "ArrowLeft", target: { isContentEditable: true } }), false);
    assert.equal(isBackShortcut({ key: "ArrowLeft", metaKey: true, target: { tagName: "DIV" } }), false);
    assert.equal(isTextInputTarget({ tagName: "textarea" }), true);
});

test("allows mutating actions only for open pull requests", () => {
    assert.equal(isPrOpen({ state: "open" }), true);
    assert.equal(isPrOpen({ state: "OPEN" }), true);
    assert.equal(isPrOpen({ state: "closed" }), false);
    assert.equal(isPrOpen({ state: "merged" }), false);
});

test("accepts only the latest asynchronous request", () => {
    const requests = new RequestGate();
    const first = requests.start();
    const second = requests.start();
    assert.equal(requests.allows(first), false);
    assert.equal(requests.allows(second), true);
    requests.invalidate();
    assert.equal(requests.allows(second), false);
});

test("renders GitHub-flavored Markdown through the sanitizer", () => {
    let sanitized = false;
    let allowedTags = [];
    const purifier = {
        sanitize(html, options) {
            sanitized = true;
            allowedTags = options.ALLOWED_TAGS;
            return html;
        },
    };
    const html = markdownHtml("**Ready**\n\n- [x] tested\n- `built`", purifier);
    assert.equal(sanitized, true);
    assert.match(html, /<strong>Ready<\/strong>/);
    assert.match(html, /<input[^>]*checked[^>]*type="checkbox"/);
    assert.match(html, /<code>built<\/code>/);
    assert.equal(allowedTags.includes("img"), false);
});

test("resolves only web Markdown links", () => {
    assert.equal(resolveMarkdownUrl("/owner/repo/issues/1", "https://github.com/owner/repo/pull/2"), "https://github.com/owner/repo/issues/1");
    assert.equal(resolveMarkdownUrl("javascript:alert(1)", "https://github.com/owner/repo/pull/2"), "");
    assert.equal(resolveMarkdownUrl("file:///tmp/token", "https://github.com/owner/repo/pull/2"), "");
});

test("derives a repository-specific sibling worktree path", () => {
    assert.equal(prWorktreePath("/Users/saeed/Projects/muxy", 42), "/Users/saeed/Projects/muxy.pr-42");
    assert.equal(prWorktreePath("/repo/", 7), "/repo.pr-7");
    assert.equal(prWorktreePath("", 9), "pr-9");
});

test("finds the repository default worktree independently of the active worktree", () => {
    const worktrees = [
        { path: "/projects/app", isPrimary: true, isActive: false },
        { path: "/projects/app-feature", isPrimary: false, isActive: true },
    ];
    assert.equal(defaultWorktreeRoot(worktrees), "/projects/app");
    assert.equal(defaultWorktreeRoot([{ path: "/projects/app", isActive: true }]), "/projects/app");
    assert.equal(defaultWorktreeRoot([]), "");
});

test("formats pull request check summaries", () => {
    assert.equal(checksLabel({ status: "success", passing: 4, total: 4 }), "4 passing");
    assert.equal(checksLabel({ status: "failure", failing: 2, total: 5 }), "2 failing");
    assert.equal(checksLabel({ status: "pending", pending: 1, total: 3 }), "1 running");
    assert.equal(checksLabel({ status: "none", total: 0 }), "");
});

test("counts changed files, additions, and deletions in a pull request diff", () => {
    const diff = [
        "diff --git a/one.js b/one.js",
        "--- a/one.js",
        "+++ b/one.js",
        "-old",
        "+new",
        "+another",
        "diff --git a/two.js b/two.js",
        "--- a/two.js",
        "+++ b/two.js",
        "-gone",
    ].join("\n");
    assert.deepEqual(diffStats(diff), { changedFiles: 2, additions: 2, deletions: 2 });
});

test("caches pull request lists and details while preserving list check state", () => {
    const cache = new PrCache();
    cache.setList([{ ...prs[0], checks: { status: "success", total: 2 } }]);
    cache.setDetails(42, { number: 42, summary: "Cached details" });
    cache.updateListItem({ number: 42, title: "Updated title", comments: [] });
    assert.equal(cache.getDetails(42).summary, "Cached details");
    assert.equal(cache.list[0].title, "Updated title");
    assert.equal(cache.list[0].checks.status, "success");
    cache.deleteListItem(42);
    assert.deepEqual(cache.list, []);
    cache.deleteDetails(42);
    assert.equal(cache.getDetails(42), undefined);
});

test("persists and restores pull request lists per repository", async () => {
    const values = new Map();
    const storage = {
        get: async (key) => values.get(key) ?? null,
        set: async (key, value) => values.set(key, structuredClone(value)),
    };
    const first = new PrCache(storage);
    assert.equal(await first.restore("/projects/one"), false);
    await first.setList(prs);
    const reopened = new PrCache(storage);
    assert.equal(await reopened.restore("/projects/one"), true);
    assert.deepEqual(reopened.list, prs);
    assert.equal(await reopened.restore("/projects/two"), false);
    assert.notEqual(prListCacheKey("/projects/one"), prListCacheKey("/projects/two"));
});
