// Minimal, safe Markdown rendering. Everything is HTML-escaped first, so the
// only tags in the output are the ones this file emits.

import { escapeHtml } from "./util.js";

/** Inline-level formatting: code spans, bold, italics, links. Input is escaped. */
function renderInline(s) {
  let t = s.replace(/`([^`\n]+)`/g, `<code class="inline">$1</code>`);
  t = t.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?])/g, "$1<em>$2</em>");
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, `<a href="$2" data-ext="1">$1</a>`);
  return t;
}

/** GitLab task list item: `- [x] done`. Returns the checkbox HTML, or "". */
function taskBox(text) {
  const m = text.match(/^\[([ xX])\]\s+/);
  if (!m) return null;
  const checked = m[1].toLowerCase() === "x";
  return {
    html: `<input type="checkbox" disabled${checked ? " checked" : ""}> `,
    rest: text.slice(m[0].length),
  };
}

export function renderMarkdown(md) {
  if (!md || !md.trim()) return `<p class="detail__empty">No description.</p>`;

  const codeBlocks = [];
  const escaped = escapeHtml(md).replace(/```([\s\S]*?)```/g, (_, code) => {
    codeBlocks.push(`<pre class="code"><code>${code.replace(/^[^\n]*\n/, "")}</code></pre>`);
    return ` CODE${codeBlocks.length - 1} `;
  });

  const ulRe = /^\s*[-*+]\s+(.*)$/;
  const olRe = /^\s*\d+[.)]\s+(.*)$/;
  const hRe = /^(#{1,6})\s+(.+)$/;
  const hrRe = /^\s*(-{3,}|\*{3,})\s*$/;
  const quoteRe = /^\s*&gt;\s?(.*)$/;

  const out = [];
  let para = [];
  let list = null;

  const flushPara = () => {
    if (para.length) out.push(`<p>${para.join("<br>")}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) { out.push(`</${list}>`); list = null; }
  };

  for (const line of escaped.split("\n")) {
    if (!line.trim()) { flushPara(); closeList(); continue; }

    if (hrRe.test(line)) { flushPara(); closeList(); continue; }

    const h = line.match(hRe);
    if (h) {
      flushPara(); closeList();
      out.push(`<div class="md-h md-h${h[1].length}">${renderInline(h[2])}</div>`);
      continue;
    }

    const q = line.match(quoteRe);
    if (q) {
      flushPara(); closeList();
      out.push(`<p class="detail__empty">${renderInline(q[1])}</p>`);
      continue;
    }

    const ul = line.match(ulRe);
    const ol = !ul && line.match(olRe);
    if (ul || ol) {
      flushPara();
      const type = ul ? "ul" : "ol";
      if (list !== type) { closeList(); out.push(`<${type} class="md-list">`); list = type; }
      const text = (ul || ol)[1];
      const task = ul ? taskBox(text) : null;
      out.push(task
        ? `<li>${task.html}${renderInline(task.rest)}</li>`
        : `<li>${renderInline(text)}</li>`);
      continue;
    }

    closeList();
    para.push(renderInline(line));
  }
  flushPara();
  closeList();

  return out.join("").replace(/ CODE(\d+) /g, (_, i) => codeBlocks[Number(i)]);
}
