import { escape_html, h } from "@/lib/dom";
import { highlight_code } from "@/lib/preview-highlight";
import { ensure_preview_highlight_css } from "@/lib/syntax-theme";
import { split_frontmatter } from "@/lib/frontmatter";

function language_of(fence) {
  const match = /^```([\w-]+)?/.exec(fence.trim());
  return match?.[1] ?? null;
}

function safe_href(href) {
  const trimmed = href.trim();
  if (/^javascript:/i.test(trimmed)) return "#";
  return trimmed;
}

function inline_html(text) {
  return text
    .split(/(`[^`]*`)/g)
    .map((part) => {
      if (part.startsWith("`") && part.endsWith("`")) return `<code>${escape_html(part.slice(1, -1))}</code>`;
      let html = escape_html(part);
      html = html.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, label, href) => {
        const safe = escape_html(safe_href(href));
        return `<a href="${safe}">${label}</a>`;
      });
      html = html.replace(/~~([^~]+)~~/g, "<del>$1</del>");
      html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      html = html.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
      return html;
    })
    .join("");
}

function is_blank(line) {
  return line.trim() === "";
}

function is_table_separator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function split_table_row(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function is_block_start(lines, index) {
  const line = lines[index] ?? "";
  const next = lines[index + 1] ?? "";
  return (
    is_blank(line) ||
    /^```/.test(line.trim()) ||
    /^#{1,4}\s+/.test(line) ||
    /^>\s?/.test(line) ||
    /^(\s*[-*]\s+|\s*\d+\.\s+)/.test(line) ||
    /^(-{3,}|\*{3,}|_{3,})$/.test(line.trim()) ||
    (line.includes("|") && is_table_separator(next))
  );
}

function append_code_block(parent, code, lang) {
  const codeNode = h("code", {}, code);
  parent.appendChild(h("pre", {}, codeNode));
  void highlight_code(code, lang).then((parts) => {
    if (!codeNode.isConnected) return;
    codeNode.replaceChildren(
      ...parts.map((part) => {
        if (!part.cls) return document.createTextNode(part.text);
        return h("span", { class: part.cls }, part.text);
      }),
    );
  });
}

function render_markdown(parent, source) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (is_blank(line)) {
      index += 1;
      continue;
    }

    if (/^```/.test(trimmed)) {
      const fence = trimmed;
      const code = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index].trim())) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      append_code_block(parent, code.join("\n"), language_of(fence));
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      parent.appendChild(h(`h${level}`, { html: inline_html(heading[2]) }));
      index += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      parent.appendChild(h("hr"));
      index += 1;
      continue;
    }

    if (line.includes("|") && is_table_separator(lines[index + 1] ?? "")) {
      const headers = split_table_row(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes("|") && !is_blank(lines[index])) {
        rows.push(split_table_row(lines[index]));
        index += 1;
      }
      parent.appendChild(
        h(
          "table",
          {},
          h("thead", {}, h("tr", {}, headers.map((cell) => h("th", { html: inline_html(cell) })))),
          h(
            "tbody",
            {},
            rows.map((row) => h("tr", {}, headers.map((_, i) => h("td", { html: inline_html(row[i] ?? "") })))),
          ),
        ),
      );
      continue;
    }

    if (/^>\s?/.test(line)) {
      const parts = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        parts.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      const blockquote = h("blockquote");
      render_markdown(blockquote, parts.join("\n"));
      parent.appendChild(blockquote);
      continue;
    }

    const listMatch = /^(\s*)([-*]|\d+\.)\s+(.+)$/.exec(line);
    if (listMatch) {
      const ordered = /\d+\./.test(listMatch[2]);
      const list = h(ordered ? "ol" : "ul");
      while (index < lines.length) {
        const match = /^(\s*)([-*]|\d+\.)\s+(.+)$/.exec(lines[index]);
        if (!match || /\d+\./.test(match[2]) !== ordered) break;
        let body = match[3];
        const task = /^\[( |x|X)\]\s+/.exec(body);
        const item = h("li");
        if (task) {
          item.appendChild(h("input", { type: "checkbox", disabled: true, checked: task[1].toLowerCase() === "x" }));
          body = body.slice(task[0].length);
        }
        item.insertAdjacentHTML("beforeend", inline_html(body));
        list.appendChild(item);
        index += 1;
      }
      parent.appendChild(list);
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && !is_block_start(lines, index)) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    parent.appendChild(h("p", { html: inline_html(paragraph.join(" ")) }));
  }
}

export class MarkdownView {
  constructor({ source, fontSize }) {
    ensure_preview_highlight_css();
    this.element = h("div", { class: "editor-host md-preview", style: { "font-size": `${fontSize}px` } });
    this.update(source, fontSize);
  }

  update(source, fontSize) {
    this.source = source;
    this.fontSize = fontSize;
    this.element.style.fontSize = `${fontSize}px`;
    this.element.replaceChildren();
    const { fields, body } = split_frontmatter(source);
    if (fields.length > 0) {
      this.element.appendChild(
        h(
          "dl",
          { class: "md-frontmatter" },
          fields.map((field) =>
            h("div", { class: "md-frontmatter-row" }, h("dt", {}, field.key), h("dd", {}, field.value)),
          ),
        ),
      );
    }
    render_markdown(this.element, body);
  }

  destroy() {
    this.element.remove();
  }
}
