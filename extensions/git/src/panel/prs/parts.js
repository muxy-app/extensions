import { cls, h } from "@/shared/dom";
import { icon } from "@/shared/icons";
import { checksLabel, prTone } from "@/core/forge/normalize";

const STATE_ICON = { open: "pr", draft: "prDraft", merged: "merge", closed: "prClosed" };
const STATE_LABEL = { open: "Open", draft: "Draft", merged: "Merged", closed: "Closed" };

export function stateIcon(pr, size = 14) {
  const tone = prTone(pr);
  return h("span", { class: `pr-icon pr-icon-${tone}`, title: STATE_LABEL[tone] }, icon(STATE_ICON[tone], size));
}

export function statePill(pr) {
  const tone = prTone(pr);
  return h("span", { class: `pill tone-${tone}` }, STATE_LABEL[tone]);
}

export function checksBadge(checks, { compact = false } = {}) {
  const label = checksLabel(checks);
  if (!label) return null;
  const name = checks.status === "failure" ? "xCircle" : checks.status === "pending" ? "loader" : "checkCircle";
  return h(
    "span",
    { class: cls("checks", `checks-${checks.status}`), title: label },
    icon(name, 12, checks.status === "pending" ? "spin" : ""),
    compact ? null : h("span", {}, label),
  );
}
