import { cls, h } from "@/shared/dom";
import { icon } from "@/shared/icons";
import { markdown } from "@/shared/markdown";
import { absoluteTime, relativeTime } from "@/shared/time";
import { checksLabel, mergeBlocker, mergeStatus, prState, prTone, reviewStatus } from "@/core/forge/normalize";

const TONE_LABEL = { open: "Open", draft: "Draft", merged: "Merged", closed: "Closed" };
const STATE_ICON = { open: "pr", draft: "prDraft", merged: "merge", closed: "prClosed" };
const METHOD_LABEL = { merge: "Merge", squash: "Squash and merge", rebase: "Rebase and merge" };
const BUCKET_ICON = { pass: "checkCircle", fail: "xCircle", pending: "loader", skipping: "circle", cancel: "circle" };
const REVIEW_LABEL = { APPROVED: "approved", CHANGES_REQUESTED: "requested changes", COMMENTED: "reviewed", DISMISSED: "review dismissed" };

function statusRow(label, value, tone, extra = null) {
  return h("div", { class: "prd-status-row" }, h("span", { class: "prd-status-label" }, label), h("span", { class: cls("prd-status-value", `tone-text-${tone}`) }, value), extra);
}

function checksList(checks, onOpen) {
  if (checks.loading) return h("div", { class: "prd-checks" }, h("div", { class: "prd-check muted" }, icon("loader", 12, "spin"), "Loading checks…"));
  if (!checks.items.length) return h("div", { class: "prd-checks" }, h("div", { class: "prd-check muted" }, "No checks reported."));
  return h(
    "div",
    { class: "prd-checks" },
    checks.items.map((check) =>
      h(
        "button",
        { type: "button", class: cls("prd-check", `prd-check-${check.bucket}`), title: check.link || check.name, onclick: () => onOpen(check.link) },
        icon(BUCKET_ICON[check.bucket] ?? "circle", 12, check.bucket === "pending" ? "spin" : ""),
        h("span", { class: "prd-check-name" }, check.workflow ? `${check.workflow} / ${check.name}` : check.name),
      ),
    ),
  );
}

function actionButton(id, label, iconName, opts = {}) {
  return h("button", { type: "button", class: cls("btn", opts.primary && "btn-primary", opts.className), dataset: { prAction: id }, disabled: opts.disabled ? true : null, title: opts.title ?? label }, iconName ? icon(iconName, 13) : null, label ? h("span", { class: "btn-label" }, label) : null);
}

function primaryActions(detail, opts) {
  if (prState(detail) !== "open") return null;
  if (detail.isDraft) return actionButton("ready", "Ready for Review", "check", { primary: true, className: "btn-block", disabled: opts.busy });
  const blocker = mergeBlocker(detail);
  return h(
    "div",
    { class: "split btn-block" },
    actionButton("merge", METHOD_LABEL[opts.method] ?? METHOD_LABEL.squash, "merge", { primary: true, disabled: opts.busy || !!blocker, title: blocker ?? `${METHOD_LABEL[opts.method]} into ${detail.baseBranch}` }),
    actionButton("method", "", "chevronDown", { primary: true, title: "Merge method", disabled: opts.busy }),
  );
}

function timelineEntry(entry) {
  const verb = entry.kind === "review" ? REVIEW_LABEL[entry.state] ?? "reviewed" : "commented";
  return h(
    "div",
    { class: "prd-entry" },
    h(
      "div",
      { class: "prd-entry-head" },
      h("span", { class: "prd-entry-author" }, entry.author),
      h("span", { class: cls("prd-entry-verb", entry.state === "APPROVED" && "tone-text-good", entry.state === "CHANGES_REQUESTED" && "tone-text-bad") }, verb),
      h("span", { class: "prd-entry-time", title: absoluteTime(entry.createdAt) }, relativeTime(entry.createdAt)),
    ),
    entry.body.trim() ? markdown(entry.body) : null,
  );
}

export function renderPrDetail(detail, opts) {
  const tone = prTone(detail);
  const merge = mergeStatus(detail);
  const review = reviewStatus(detail);
  const checks = checksLabel(detail.checks);
  const stats = detail.changedFiles != null ? `${detail.changedFiles} file${detail.changedFiles === 1 ? "" : "s"}` : null;
  const open = prState(detail) === "open";
  const root = h(
    "div",
    { class: "prd" },
    h("div", { class: "prd-title" }, h("span", { class: `pr-icon pr-icon-${tone}` }, icon(STATE_ICON[tone], 15)), h("span", {}, detail.title)),
    h(
      "div",
      { class: "prd-meta" },
      h("span", { class: `pill tone-${tone}` }, TONE_LABEL[tone]),
      h("span", { class: "mono" }, `#${detail.number}`),
      detail.author ? h("span", {}, detail.author) : null,
      detail.createdAt ? h("span", { title: absoluteTime(detail.createdAt) }, `opened ${relativeTime(detail.createdAt)} ago`) : null,
    ),
    h("div", { class: "prd-branch mono", title: `${detail.headBranch} → ${detail.baseBranch}` }, `${detail.headBranch} → ${detail.baseBranch}`),
    detail.labels?.length ? h("div", { class: "prd-labels" }, detail.labels.map((label) => h("span", { class: "chip chip-muted" }, label))) : null,
    h(
      "div",
      { class: "prd-status" },
      statusRow("Merge", merge.label, merge.tone),
      open ? statusRow("Review", review.label, review.tone) : null,
      statusRow(
        "Checks",
        checks || "None",
        detail.checks?.status === "failure" ? "bad" : detail.checks?.status === "success" ? "good" : "muted",
        opts.checks ? h("button", { type: "button", class: "link-btn", dataset: { prAction: "toggle-checks" } }, opts.checks.open ? "Hide" : "Show") : null,
      ),
      stats ? statusRow("Changes", h("span", {}, `${stats} `, h("span", { class: "text-add" }, `+${detail.additions}`), " ", h("span", { class: "text-remove" }, `−${detail.deletions}`)), "plain") : null,
    ),
    opts.checks?.open ? checksList(opts.checks, opts.onOpenUrl) : null,
    h(
      "div",
      { class: "prd-actions" },
      primaryActions(detail, opts),
      h(
        "div",
        { class: "prd-secondary" },
        open ? actionButton("checkout", "Check Out", "branch", { disabled: opts.busy }) : null,
        open ? actionButton("worktree", "Worktree", "worktree", { disabled: opts.busy, title: "Check out in a new worktree" }) : null,
        opts.hideChanges ? null : actionButton("changes", "Changes", "file", { title: "View the diff" }),
        actionButton("more", "", "more", { title: "More actions" }),
      ),
    ),
    h("div", { class: "prd-section" }, h("div", { class: "prd-section-title" }, "Description"), detail.body?.trim() ? markdown(detail.body) : h("div", { class: "muted" }, "No description provided.")),
    detail.timeline?.length
      ? h("div", { class: "prd-section" }, h("div", { class: "prd-section-title" }, `Activity · ${detail.timeline.length}`), detail.timeline.map(timelineEntry))
      : null,
  );
  root.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-pr-action]");
    if (button && !button.disabled) opts.onAction(button.dataset.prAction, button);
  });
  return root;
}
