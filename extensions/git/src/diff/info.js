import { cls, h } from "@/shared/dom";
import { icon } from "@/shared/icons";
import { absoluteTime } from "@/shared/time";
import { copyText } from "@/shared/actions";

function commitCard(details, { onOpenCommit }) {
  return [
    h("div", { class: "info-title" }, details.subject),
    details.body ? h("div", { class: "info-body" }, details.body) : null,
    h(
      "div",
      { class: "info-meta" },
      h("span", {}, details.authorName),
      h("span", { title: details.authorEmail }, absoluteTime(details.authorDate)),
      h("button", { type: "button", class: "link-btn mono", title: "Copy full hash", onclick: () => void copyText(details.hash, `Copied ${details.shortHash}`) }, details.shortHash),
      details.parents.length
        ? h(
            "span",
            { class: "info-parents" },
            details.parents.length > 1 ? "Parents" : "Parent",
            details.parents.map((hash) => h("button", { type: "button", class: "link-btn mono", onclick: () => onOpenCommit(hash) }, hash.slice(0, 7))),
          )
        : null,
    ),
  ];
}

export function renderInfo(info, { expanded, onToggle, onOpenCommit, prDetail }) {
  if (!info) return null;
  const body = info.kind === "commit" ? commitCard(info.details, { onOpenCommit }) : prDetail.el;
  return h(
    "div",
    { class: cls("info", !expanded && "info-collapsed") },
    h("button", { type: "button", class: "info-toggle icon-btn icon-btn-sm", title: expanded ? "Hide details" : "Show details", onclick: onToggle }, icon(expanded ? "chevronDown" : "chevronRight", 13)),
    h("div", { class: "info-content" }, body),
  );
}
