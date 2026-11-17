import { escape_html, h } from "@/shared/dom";
import { resolve_rel } from "@/shared/paths";
import { open_url } from "@/shared/actions";
import { open_file } from "@/shared/editors";
import { highlight_code } from "./preview-highlight";
import { render_mermaid } from "./mermaid-render";
import { ensure_preview_highlight_css } from "../code/syntax-theme";
import { split_frontmatter } from "./frontmatter";
import { toggle_task_in_source } from "./markdown-tasks";
import { image_source } from "./markdown-images";
import {
  collect_html_block,
  decode_entities,
  extract_inline_html,
  find_open_element,
  html_block_start,
  leading_closes,
  restore_inline_html,
  safe_href,
  sanitize_html_block,
  unclosed_containers,
} from "./markdown-html";
import { read_image_data_url } from "./image-data";
import { is_image, is_svg } from "../kinds";

/** An element whose content is trusted, already-escaped inline HTML. */
function html(tag, markup) {
  const node = document.createElement(tag);
  node.innerHTML = markup;
  return node;
}

async function is_internal_file(path) {
  try {
    const stat = await muxy.files.stat(path);
    return Boolean(stat) && !stat.isDirectory;
  } catch {
    return false;
  }
}

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

function inline_html(text) {
  return text
    .split(/(`[^`]*`)/g)
    .map((part) => {
      if (part.startsWith("`") && part.endsWith("`")) return `<code>${escape_html(part.slice(1, -1))}</code>`;
      const { text: rest, markup } = extract_inline_html(part);
      let html = escape_html(rest);
      html = html.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, label, href) => {
        const safe = escape_html(safe_href(decode_entities(href)));
        return `<a href="${safe}">${label}</a>`;
      });
      html = html.replace(/~~([^~]+)~~/g, "<del>$1</del>");
      html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      html = html.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
      return restore_inline_html(html, markup);
    })
    .join("");
}

function is_blank(line) {
  return line.trim() === "";
}

// A list item marker: indent, bullet or number, the gap after it, and the text.
const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(.+)$/;
const HR_RE = /^([-*_])(\s*\1){2,}$/;

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

function table_alignments(line) {
  return split_table_row(line).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return left ? "left" : null;
  });
}

function starts_block(line, next = "") {
  return (
    is_blank(line) ||
    html_block_start(line) !== null ||
    /^```/.test(line.trim()) ||
    /^#{1,6}\s+/.test(line) ||
    /^>\s?/.test(line) ||
    LIST_RE.test(line) ||
    HR_RE.test(line.trim()) ||
    (line.includes("|") && is_table_separator(next))
  );
}

function is_block_start(lines, index) {
  return starts_block(lines[index] ?? "", lines[index + 1] ?? "");
}

/** Leading whitespace width, with tabs advancing to the next multiple of 4. */
function indent_of(line) {
  let width = 0;
  for (const ch of line) {
    if (ch === " ") width += 1;
    else if (ch === "\t") width += 4 - (width % 4);
    else break;
  }
  return width;
}

/** Removes up to `amount` columns of leading whitespace. */
function dedent(line, amount) {
  let width = 0;
  let i = 0;
  while (i < line.length && width < amount) {
    if (line[i] === " ") width += 1;
    else if (line[i] === "\t") width += 4 - (width % 4);
    else break;
    i += 1;
  }
  return line.slice(i);
}

function parse_marker(line) {
  const match = LIST_RE.exec(line);
  if (!match) return null;
  const indent = indent_of(match[1]);
  const ordered = /\d/.test(match[2]);
  return {
    indent,
    ordered,
    number: ordered ? Number.parseInt(match[2], 10) : null,
    // Where the item's own content starts; its nested lines are dedented by this.
    content: indent + match[2].length + Math.min(match[3].length, 4),
    text: match[4],
  };
}

function render_list_item(text, children, isDark, ctx) {
  let body = text;
  const item = h("li");
  const task = /^\[( |x|X)\]\s+/.exec(body);
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
  while (children.length > 0 && is_blank(children[children.length - 1])) children.pop();
  if (children.length > 0) render_markdown(item, children.join("\n"), isDark, ctx);
  return item;
}

/**
 * Renders the list starting at `start` and returns the index after it. Lines
 * indented past an item's marker belong to that item (nested lists, code,
 * paragraphs), and blank lines between items keep one list going, so an
 * ordered list doesn't restart its numbering.
 */
function render_list(parent, lines, start, isDark, ctx) {
  const first = parse_marker(lines[start]);
  const base = first.indent;
  const list = h(first.ordered ? "ol" : "ul");
  if (first.ordered && first.number !== 1) list.setAttribute("start", String(first.number));
  const is_sibling = (marker) => marker !== null && marker.ordered === first.ordered && marker.indent <= base + 1;

  let index = start;
  while (index < lines.length) {
    const marker = parse_marker(lines[index]);
    if (!is_sibling(marker)) break;
    index += 1;

    // Wrapped lines of the item's first paragraph.
    const text = [marker.text];
    while (
      index < lines.length &&
      !parse_marker(lines[index]) &&
      !starts_block(dedent(lines[index], marker.content), lines[index + 1] ?? "")
    ) {
      text.push(lines[index].trim());
      index += 1;
    }

    const children = [];
    while (index < lines.length) {
      const line = lines[index];
      if (is_blank(line)) {
        let next = index + 1;
        while (next < lines.length && is_blank(lines[next])) next += 1;
        if (next >= lines.length || indent_of(lines[next]) <= base + 1) break;
        for (; index < next; index += 1) children.push("");
        continue;
      }
      if (indent_of(line) <= base + 1) break;
      children.push(dedent(line, marker.content));
      index += 1;
    }

    list.appendChild(render_list_item(text.join(" "), children, isDark, ctx));

    let next = index;
    while (next < lines.length && is_blank(lines[next])) next += 1;
    if (next === index) continue;
    if (next < lines.length && is_sibling(parse_marker(lines[next]))) index = next;
    else break;
  }
  parent.appendChild(list);
  return index;
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

/** Gives headings from an HTML block ids and a place in the table of contents. */
function register_html_headings(fragment, ctx) {
  if (!ctx) return;
  for (const node of fragment.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    const text = node.textContent.replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (!node.id) node.id = ctx.slug(text);
    ctx.headings.push({ level: Number(node.localName[1]), text, id: node.id, node });
  }
}

function render_markdown(parent, source, isDark, ctx) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  // HTML wrappers (`<div align="center">`, `<details>`) left open by a block;
  // the markdown that follows renders inside them until their closing tag.
  const open = [];

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

    const htmlStart = html_block_start(line);
    if (htmlStart) {
      const block = collect_html_block(lines, index, htmlStart);
      index = block.next;
      if (htmlStart.end === "comment") continue;
      const { closes, rest } = leading_closes(block.html);
      for (const tag of closes) {
        if (open.length > 0 && open[open.length - 1].tag === tag) parent = open.pop().parent;
      }
      if (rest.trim() === "") continue;
      const fragment = sanitize_html_block(rest, isDark);
      register_html_headings(fragment, ctx);
      const holders = [];
      let scope = fragment;
      for (const tag of unclosed_containers(rest)) {
        const element = find_open_element(scope, tag);
        if (!element) break;
        holders.push({ tag, element });
        scope = element;
      }
      parent.appendChild(fragment);
      for (const { tag, element } of holders) {
        open.push({ tag, parent });
        parent = element;
      }
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const content = heading[2].replace(/\s+#+\s*$/, "");
      const node = html(`h${level}`, inline_html(content));
      if (ctx) {
        const text = heading_text(content);
        const id = ctx.slug(text);
        node.id = id;
        ctx.headings.push({ level, text, id, node });
      }
      parent.appendChild(node);
      index += 1;
      continue;
    }

    if (HR_RE.test(trimmed)) {
      parent.appendChild(h("hr"));
      index += 1;
      continue;
    }

    if (line.includes("|") && is_table_separator(lines[index + 1] ?? "")) {
      const headers = split_table_row(line);
      const aligns = table_alignments(lines[index + 1]);
      const cell = (tag, markup, i) => {
        const node = html(tag, inline_html(markup));
        if (aligns[i]) node.style.textAlign = aligns[i];
        return node;
      };
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
          h("thead", {}, h("tr", {}, headers.map((text, i) => cell("th", text, i)))),
          h(
            "tbody",
            {},
            rows.map((row) => h("tr", {}, headers.map((_, i) => cell("td", row[i] ?? "", i)))),
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

    if (LIST_RE.test(line)) {
      index = render_list(parent, lines, index, isDark, ctx);
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && !is_block_start(lines, index)) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    parent.appendChild(html("p", inline_html(paragraph.join(" "))));
  }
}

const TOC_MIN_HEADINGS = 2;
const REMOTE_IMAGE_ICON =
  '<svg class="md-img-remote-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" ' +
  'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="10" rx="1.5"/>' +
  '<circle cx="5.75" cy="6.5" r="1.1"/><path d="m2.5 12 3.6-3.6 2.4 2.4 1.7-1.7 3.3 3.3"/></svg>';
// Prose reads small at the code editor's size, so the preview sits a step above it.
const PREVIEW_FONT_BOOST = 2;
const PREVIEW_WIDTHS = new Set(["narrow", "wide", "full"]);

function preview_width(width) {
  return PREVIEW_WIDTHS.has(width) ? width : "wide";
}

export class MarkdownView {
  constructor({ source, fontSize, isDark, filePath, width = "wide", showToc = false, onToggleTask = null }) {
    ensure_preview_highlight_css();
    this.filePath = filePath;
    this.showToc = showToc;
    this.onToggleTask = onToggleTask;
    this.headings = [];
    // Project images read for this view, by path, so re-renders reuse them.
    this.imageCache = new Map();
    // Web images stay behind a placeholder until the user loads them, since
    // fetching one tells its server this file was opened. Lasts for this view.
    this.remoteImagesAllowed = false;
    this.tocLinks = new Map();
    this.activeId = null;
    this.scrollRaf = 0;
    this.element = h("div", { class: "editor-host md-preview", dataset: { width: preview_width(width) } });
    this.scroller = h("div", { class: "md-scroll" });
    this.toc = h("nav", { class: "md-toc", "aria-label": "Table of contents" });
    this.element.append(this.scroller, this.toc);
    this.onClick = (event) => this.handleClick(event);
    this.onScroll = () => this.scheduleSpy();
    this.element.addEventListener("click", this.onClick);
    this.scroller.addEventListener("scroll", this.onScroll, { passive: true });
    this.update(source, fontSize, isDark);
  }

  setWidth(width) {
    this.element.dataset.width = preview_width(width);
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
    const placeholder = event.target instanceof Element ? event.target.closest(".md-img-remote") : null;
    if (placeholder && this.element.contains(placeholder)) {
      event.preventDefault();
      event.stopPropagation();
      this.allowRemoteImages();
      return;
    }

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
    const target =
      this.scroller.querySelector(`#${CSS.escape(id)}`) ??
      this.scroller.querySelector(`a[name="${CSS.escape(id)}"]`);
    if (!target) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    this.setActive(id);
  }

  async openLinkTarget(target, hash) {
    if (await is_internal_file(target)) {
      void open_file(target);
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
    this.element.style.fontSize = `${fontSize + PREVIEW_FONT_BOOST}px`;
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
    this.loadImages(documentElement);
    this.activeId = null;
    this.renderToc();
  }

  /**
   * Points each image at its data. Web images load directly; project files
   * are read through the host, since the page isn't served from the project.
   */
  loadImages(root) {
    for (const img of root.querySelectorAll("img.md-img")) {
      img.addEventListener("error", () => this.showMissingImage(img), { once: true });
      const source = image_source(img.dataset.src, this.filePath);
      if (!source) {
        this.showMissingImage(img);
      } else if (source.kind === "url") {
        img.src = source.url;
      } else if (source.kind === "remote") {
        if (this.remoteImagesAllowed) img.src = source.url;
        else this.showRemotePlaceholder(img, source);
      } else {
        this.readImage(source.path).then(
          (url) => {
            if (img.isConnected) img.src = url;
          },
          () => {
            if (img.isConnected) this.showMissingImage(img);
          },
        );
      }
    }
  }

  readImage(path) {
    let pending = this.imageCache.get(path);
    if (pending) return pending;
    if (is_svg(path)) {
      pending = muxy.files
        .read(path)
        .then((file) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(file.content)}`);
    } else if (is_image(path)) {
      pending = read_image_data_url(path);
    } else {
      pending = Promise.reject(new Error(`Not an image: ${path}`));
    }
    // A failed read (missing file, say) is retried on the next render.
    pending.catch(() => this.imageCache.delete(path));
    this.imageCache.set(path, pending);
    return pending;
  }

  /** A stand-in for a web image; clicking it loads this document's web images. */
  showRemotePlaceholder(img, source) {
    const label = img.alt || img.title || "Image";
    const placeholder = h(
      "button",
      {
        type: "button",
        class: "md-img-remote",
        title: `Load images from the web in this document\n${source.url}`,
        dataset: { src: img.dataset.src },
      },
      html("span", REMOTE_IMAGE_ICON),
      h("span", { class: "md-img-remote-label" }, label),
      h("span", { class: "md-img-remote-host" }, source.host),
    );
    placeholder.originalImage = img;
    img.replaceWith(placeholder);
  }

  allowRemoteImages() {
    if (this.remoteImagesAllowed) return;
    this.remoteImagesAllowed = true;
    for (const placeholder of this.scroller.querySelectorAll(".md-img-remote")) {
      const img = placeholder.originalImage;
      const source = img ? image_source(img.dataset.src, this.filePath) : null;
      if (!img || source?.kind !== "remote") continue;
      placeholder.replaceWith(img);
      img.src = source.url;
    }
  }

  showMissingImage(img) {
    const label = img.alt || img.dataset.src || "Image";
    img.replaceWith(
      h("span", { class: "md-img-missing", title: `Could not load ${img.dataset.src ?? "image"}` }, label),
    );
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
      const node = heading.node;
      if (!node?.isConnected) continue;
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
    this.imageCache.clear();
    this.element.remove();
  }
}
