import { cls, h } from "@/shared/dom";
import { icon } from "@/shared/icons";
import { openMenuBelow } from "@/shared/menu";
import { openUrl } from "@/shared/actions";
import { checksLabel, mergeBlocker, mergeStatus, prState, reviewStatus } from "@/core/forge/normalize";
import { mergeMethod, methodLabel, setMergeMethod } from "@/core/pr-flow";
import { button, iconButton, placeholder } from "@/panel/ui";
import { stateIcon, statePill } from "@/panel/prs/parts";
import * as ops from "@/panel/ops/pr";

function statusLine(label, value, tone, onClick = null) {
  return h(
    onClick ? "button" : "div",
    { type: onClick ? "button" : null, class: cls("card-status", onClick && "card-status-button"), onclick: onClick },
    h("span", { class: "card-status-label" }, label),
    h("span", { class: cls("card-status-value", `tone-text-${tone}`) }, value),
    onClick ? icon("chevronRight", 12) : null,
  );
}

function mergeControls(view, pr) {
  const ctl = view.ctl;
  if (prState(pr) !== "open") return null;
  if (pr.isDraft) return button("Ready for Review", { primary: true, iconName: "check", className: "btn-block", onClick: () => void view.act(() => ops.readyPr(ctl, pr)) });
  const method = mergeMethod();
  const blocker = mergeBlocker(pr);
  const main = button(methodLabel(method), { primary: true, iconName: "merge", onClick: () => void view.act(() => ops.mergePr(ctl, pr, method)) });
  main.disabled = !!blocker;
  main.title = blocker ?? `${methodLabel(method)} into ${pr.baseBranch}`;
  const choose = h("button", { type: "button", class: "btn btn-primary", title: "Merge method", "aria-label": "Merge method" }, icon("chevronDown", 13));
  choose.onclick = () =>
    openMenuBelow(
      choose,
      ["merge", "squash", "rebase"].map((value) => ({
        label: methodLabel(value),
        checked: value === method,
        run: () => {
          setMergeMethod(value);
          view.render();
        },
      })),
      "end",
    );
  return h("div", { class: "split btn-block" }, main, choose);
}

export function renderNoPr(view, state) {
  const { status, forge } = state;
  if (forge === "none") return placeholder("No remote", "Add a remote named origin to work with pull requests.");
  if (view.creating) return view.createHost;
  const onDefault = status?.branch && status.branch === status.defaultBranch;
  return h(
    "div",
    { class: "pr-card pr-card-empty" },
    h("div", { class: "pr-card-text" }, onDefault ? `You're on ${status.branch}. Start a pull request and a new branch from your changes.` : h("span", {}, "No pull request for ", h("span", { class: "mono" }, status?.branch ?? "this branch"), " yet.")),
    button("Create Pull Request", { primary: true, iconName: "pr", onClick: () => view.startCreate() }),
  );
}

export function renderCard(view, pr) {
  const ctl = view.ctl;
  const merge = mergeStatus(pr);
  const review = reviewStatus(pr);
  const open = prState(pr) === "open";
  const more = iconButton("more", "More Actions");
  more.onclick = () => openMenuBelow(more, [{ label: "View Changes", run: () => ops.viewPr(ctl, pr) }, ...ops.prMoreMenu(ctl, pr, { onRefresh: () => view.refreshCurrent(true), onChanged: () => view.refreshAll() }), "-", { label: ctl.state.repo?.isWorktree ? "Clean Up Worktree…" : "Clean Up Branch…", run: () => void view.act(() => ops.cleanupCurrent(ctl)) }], "end");
  return h(
    "div",
    { class: "pr-card" },
    h("button", { type: "button", class: "pr-card-head", title: "Show details", onclick: () => view.openDetail(pr) }, stateIcon(pr), h("span", { class: "pr-card-title" }, pr.title)),
    h("div", { class: "pr-card-meta" }, statePill(pr), h("span", { class: "mono" }, `#${pr.number}`), h("span", { class: "pr-card-branch mono" }, `→ ${pr.baseBranch}`)),
    h(
      "div",
      { class: "card-statuses" },
      statusLine("Merge", merge.label, merge.tone),
      open ? statusLine("Review", review.label, review.tone) : null,
      statusLine("Checks", checksLabel(pr.checks) || "None", pr.checks.status === "failure" ? "bad" : pr.checks.status === "success" ? "good" : "muted", () => view.openDetail(pr, { checks: true })),
    ),
    h("div", { class: "pr-card-actions" }, mergeControls(view, pr), iconButton("external", "Open in Browser", { onClick: () => openUrl(pr.url) }), more),
  );
}
