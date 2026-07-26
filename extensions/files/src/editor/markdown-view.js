import { escape_html, h } from "@/lib/dom";
import { highlight_code } from "@/lib/preview-highlight";
import { render_mermaid } from "@/lib/mermaid-render";
import { ensure_preview_highlight_css } from "@/lib/syntax-theme";
import { split_frontmatter } from "@/lib/frontmatter";
import { is_internal_file, open_in_new_tab, open_url, resolve_rel } from "@/lib/files";

function has_scheme(href) {
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

function language_of(fence) {
  const match = /^```([\w-]+)?/.exec(fence.trim());
  return match?.[1] ?? null;
}

function heading_text(markdown) {
  return markdown
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function make_slugger() {
  const seen = new Map();
  return (text) => {
    const base = slugify(text) || "section";
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
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

const TASK_MARKER_RE = /^(\s*(?:[-*]|\d+\.)\s+\[)( |x|X)(\]\s+)/;

// Flip the Nth task-list marker in `source` to `checked`, scanning lines in the
// same top-to-bottom order the renderer assigns checkbox indices. Returns the
// updated source, or null when the index has no matching marker.
function toggle_task_in_source(source, index, checked) {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  let count = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const match = TASK_MARKER_RE.exec(lines[i]);
    if (!match) continue;
    if (count === index) {
      lines[i] = lines[i].replace(TASK_MARKER_RE, `$1${checked ? "x" : " "}$3`);
      return lines.join(newline);
    }
    count += 1;
  }
  return null;
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

function append_code_block(parent, code, lang, isDark) {
  if (lang === "mermaid") {
    const container = h("div", { class: "md-mermaid" });
    parent.appendChild(container);
    void render_mermaid(container, code, isDark);
    return;
  }
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

function render_markdown(parent, source, isDark, ctx) {
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
      append_code_block(parent, code.join("\n"), language_of(fence), isDark);
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const node = h(`h${level}`, { html: inline_html(heading[2]) });
      if (ctx) {
        const text = heading_text(heading[2]);
        const id = ctx.slug(text);
        node.id = id;
        ctx.headings.push({ level, text, id });
      }
      parent.appendChild(node);
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
      render_markdown(blockquote, parts.join("\n"), isDark, ctx);
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
          const taskIndex = ctx ? ctx.tasks++ : -1;
          item.classList.add("md-task-item");
          const checkbox = h("input", {
            type: "checkbox",
            class: "md-task-checkbox",
            checked: task[1].toLowerCase() === "x",
            disabled: taskIndex < 0,
          });
          if (taskIndex >= 0) checkbox.dataset.taskIndex = String(taskIndex);
          item.appendChild(checkbox);
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

const TOC_MIN_HEADINGS = 2;

export class MarkdownView {
  constructor({ source, fontSize, isDark, filePath, showToc = false, onToggleTask = null }) {
    ensure_preview_highlight_css();
    this.filePath = filePath;
    this.showToc = showToc;
    this.onToggleTask = onToggleTask;
    this.headings = [];
    this.tocLinks = new Map();
    this.activeId = null;
    this.scrollRaf = 0;
    this.element = h("div", { class: "editor-host md-preview", style: { "font-size": `${fontSize}px` } });
    this.scroller = h("div", { class: "md-scroll" });
    this.toc = h("nav", { class: "md-toc", "aria-label": "Table of contents" });
    this.element.append(this.scroller, this.toc);
    this.onClick = (event) => this.handleClick(event);
    this.onScroll = () => this.scheduleSpy();
    this.element.addEventListener("click", this.onClick);
    this.scroller.addEventListener("scroll", this.onScroll, { passive: true });
    this.update(source, fontSize, isDark);
  }

  setShowToc(showToc) {
    if (this.showToc === showToc) return;
    this.showToc = showToc;
    this.renderToc();
  }

  hasToc() {
    return this.headings.length >= TOC_MIN_HEADINGS;
  }

  handleClick(event) {
    const checkbox =
      event.target instanceof HTMLInputElement && event.target.classList.contains("md-task-checkbox")
        ? event.target
        : null;
    if (checkbox) {
      const index = Number(checkbox.dataset.taskIndex);
      if (!this.onToggleTask || !Number.isInteger(index) || index < 0) {
        event.preventDefault();
        return;
      }
      const next = this.toggleTask(index, checkbox.checked);
      if (next === null) {
        event.preventDefault();
        return;
      }
      this.source = next;
      this.onToggleTask(next);
      return;
    }

    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey) return;

    const tocLink = event.target instanceof Element ? event.target.closest("a.md-toc-link") : null;
    if (tocLink && this.toc.contains(tocLink)) {
      event.preventDefault();
      this.scrollToHeading(tocLink.dataset.target);
      return;
    }

    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!anchor || !this.element.contains(anchor)) return;
    const href = anchor.getAttribute("href") ?? "";

    if (href === "") return;
    if (href.startsWith("#")) {
      event.preventDefault();
      this.scrollToHeading(decodeURIComponent(href.slice(1)));
      return;
    }

    event.preventDefault();

    if (has_scheme(href)) {
      void open_url(href);
      return;
    }

    if (!this.filePath) {
      void open_url(href);
      return;
    }
    const [path, hash] = href.split("#");
    const target = resolve_rel(this.filePath, path);
    if (target === null) {
      void open_url(href);
      return;
    }
    void this.openLinkTarget(target, hash);
  }

  scrollToHeading(id) {
    if (!id) return;
    const target = this.scroller.querySelector(`#${CSS.escape(id)}`);
    if (!target) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    this.setActive(id);
  }

  async openLinkTarget(target, hash) {
    if (await is_internal_file(target)) {
      void open_in_new_tab(target);
      return;
    }
    void open_url(hash ? `${target}#${hash}` : target);
  }

  toggleTask(index, checked) {
    const { body } = split_frontmatter(this.source);
    const prefix = this.source.slice(0, this.source.length - body.length);
    const nextBody = toggle_task_in_source(body, index, checked);
    if (nextBody === null) return null;
    return prefix + nextBody;
  }

  update(source, fontSize, isDark) {
    this.source = source;
    this.fontSize = fontSize;
    this.isDark = isDark;
    this.element.style.fontSize = `${fontSize}px`;
    const documentElement = h("div", { class: "md-preview-document" });
    const { fields, body } = split_frontmatter(source);
    if (fields.length > 0) {
      documentElement.appendChild(
        h(
          "dl",
          { class: "md-frontmatter" },
          fields.map((field) =>
            h("div", { class: "md-frontmatter-row" }, h("dt", {}, field.key), h("dd", {}, field.value)),
          ),
        ),
      );
    }
    this.headings = [];
    render_markdown(documentElement, body, isDark, { slug: make_slugger(), headings: this.headings, tasks: 0 });
    this.scroller.replaceChildren(documentElement);
    this.activeId = null;
    this.renderToc();
  }

  renderToc() {
    this.tocLinks.clear();
    if (!this.showToc || !this.hasToc()) {
      this.toc.replaceChildren();
      this.element.classList.remove("md-preview-with-toc");
      return;
    }
    this.element.classList.add("md-preview-with-toc");
    const minLevel = this.headings.reduce((min, item) => Math.min(min, item.level), 6);
    const list = h("ul", { class: "md-toc-list" });
    for (const heading of this.headings) {
      const link = h("a", {
        class: "md-toc-link",
        href: `#${heading.id}`,
        dataset: { target: heading.id, depth: String(heading.level - minLevel) },
        title: heading.text,
      });
      link.textContent = heading.text;
      this.tocLinks.set(heading.id, link);
      list.appendChild(h("li", { class: "md-toc-item" }, link));
    }
    this.toc.replaceChildren(h("div", { class: "md-toc-heading" }, "On this page"), list);
    this.scheduleSpy();
  }

  scheduleSpy() {
    if (this.scrollRaf) return;
    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = 0;
      this.updateActiveHeading();
    });
  }

  updateActiveHeading() {
    if (this.tocLinks.size === 0) return;
    const viewTop = this.scroller.getBoundingClientRect().top;
    const threshold = viewTop + this.scroller.clientHeight * 0.25;
    let active = this.headings[0]?.id ?? null;
    for (const heading of this.headings) {
      const node = this.scroller.querySelector(`#${CSS.escape(heading.id)}`);
      if (!node) continue;
      if (node.getBoundingClientRect().top <= threshold) active = heading.id;
      else break;
    }
    // Near the bottom, force the last heading active so the tail is reachable.
    if (this.scroller.scrollTop + this.scroller.clientHeight >= this.scroller.scrollHeight - 4) {
      active = this.headings[this.headings.length - 1]?.id ?? active;
    }
    this.setActive(active);
  }

  setActive(id) {
    if (this.activeId === id) return;
    if (this.activeId) this.tocLinks.get(this.activeId)?.classList.remove("md-toc-link-active");
    this.activeId = id;
    const link = id ? this.tocLinks.get(id) : null;
    if (link) {
      link.classList.add("md-toc-link-active");
      link.scrollIntoView({ block: "nearest" });
    }
  }

  destroy() {
    if (this.scrollRaf) cancelAnimationFrame(this.scrollRaf);
    this.element.removeEventListener("click", this.onClick);
    this.scroller.removeEventListener("scroll", this.onScroll);
    this.element.remove();
  }
}
