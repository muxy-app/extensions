import { marked } from "marked";
import DOMPurify from "dompurify";
import { h } from "@/shared/dom";
import { openUrl } from "@/shared/actions";

export function markdown(text) {
  const node = h("div", { class: "markdown" });
  node.innerHTML = DOMPurify.sanitize(marked.parse(String(text ?? ""), { gfm: true, breaks: true, async: false }));
  node.addEventListener("click", (event) => {
    const link = event.target.closest?.("a[href]");
    if (!link) return;
    event.preventDefault();
    openUrl(link.href);
  });
  return node;
}
