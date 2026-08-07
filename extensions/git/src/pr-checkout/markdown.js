import DOMPurify from "dompurify";
import { marked } from "marked";

const MARKDOWN_TAGS = [
    "a", "blockquote", "br", "code", "del", "details", "em", "h1", "h2", "h3", "h4", "h5", "h6",
    "hr", "input", "kbd", "li", "ol", "p", "pre", "span", "strong", "sub", "summary", "sup",
    "table", "tbody", "td", "th", "thead", "tr", "ul",
];

const MARKDOWN_ATTRS = ["checked", "class", "disabled", "href", "title", "type"];

export function markdownHtml(source, purifier = DOMPurify) {
    const input = String(source ?? "").replace(/^[\u200B-\u200F\uFEFF]/, "");
    const html = marked.parse(input, { breaks: true, gfm: true });
    return purifier.sanitize(html, {
        ALLOWED_TAGS: MARKDOWN_TAGS,
        ALLOWED_ATTR: MARKDOWN_ATTRS,
        ALLOW_DATA_ATTR: false,
    });
}

export function resolveMarkdownUrl(value, baseUrl = "") {
    try {
        const url = new URL(value, baseUrl || undefined);
        return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
    }
    catch {
        return "";
    }
}

export function markdownBlock(source, { baseUrl = "", emptyText = "", onOpen } = {}) {
    const text = String(source ?? "").trim();
    if (!text) {
        const empty = document.createElement("p");
        empty.className = "pr-detail-empty";
        empty.textContent = emptyText;
        return empty;
    }
    const block = document.createElement("div");
    block.className = "pr-markdown";
    block.innerHTML = markdownHtml(text);
    for (const anchor of block.querySelectorAll("a")) {
        const href = resolveMarkdownUrl(anchor.getAttribute("href"), baseUrl);
        if (!href) {
            anchor.replaceWith(...anchor.childNodes);
            continue;
        }
        anchor.setAttribute("href", href);
        anchor.setAttribute("rel", "noreferrer");
        anchor.setAttribute("title", anchor.getAttribute("title") || "Open in browser");
    }
    for (const input of block.querySelectorAll("input")) {
        input.disabled = true;
        input.tabIndex = -1;
    }
    block.addEventListener("click", (event) => {
        const anchor = event.target.closest?.("a");
        if (!anchor || !block.contains(anchor))
            return;
        event.preventDefault();
        onOpen?.(anchor.getAttribute("href"));
    });
    return block;
}
