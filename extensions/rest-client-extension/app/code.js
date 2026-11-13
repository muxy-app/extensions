// A small code editor: a textarea over a highlighted copy of its text, with
// line numbers, Tab to indent, and auto-indent on Enter.
import { highlight } from "./highlight.js";

function insertText(ta, text) {
  ta.focus({ preventScroll: true });
  // keeps the undo stack, unlike setting .value
  if (!document.execCommand?.("insertText", false, text)) {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

export function mountCode(host, { value = "", onChange = () => {}, language = "text", vars = null, placeholder = "", readOnly = false } = {}) {
  host.innerHTML = `<div class="code">
    <div class="code-gutter" aria-hidden="true"><div class="code-lines"></div></div>
    <div class="code-main">
      <pre class="code-hl" aria-hidden="true"></pre>
      <textarea class="code-input" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" wrap="off"></textarea>
    </div>
  </div>`;
  const ta = host.querySelector(".code-input");
  const hl = host.querySelector(".code-hl");
  const lines = host.querySelector(".code-lines");
  ta.value = value;
  ta.placeholder = placeholder;
  ta.readOnly = readOnly;
  let lineCount = -1;
  let lang = language;
  let varMap = vars;

  const sync = () => {
    hl.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
    lines.style.transform = `translateY(${-ta.scrollTop}px)`;
  };
  const paint = () => {
    const v = ta.value;
    hl.innerHTML = `${v.length > 400000 ? v.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]) : highlight(v, lang, varMap)}\n `;
    let n = 1;
    for (let i = 0; i < v.length; i++) if (v.charCodeAt(i) === 10) n++;
    if (n !== lineCount) {
      lineCount = n;
      let s = "";
      for (let i = 1; i <= n; i++) s += i === n ? i : `${i}\n`;
      lines.textContent = s;
    }
    sync();
  };

  ta.addEventListener("input", () => {
    paint();
    onChange(ta.value);
  });
  ta.addEventListener("scroll", sync);
  ta.addEventListener("keydown", (e) => {
    if (readOnly || e.isComposing) return;
    if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const { selectionStart: a, selectionEnd: b, value: v } = ta;
      if (a === b && !e.shiftKey) {
        insertText(ta, "  ");
        return;
      }
      // indent or outdent the selected lines
      const start = v.lastIndexOf("\n", a - 1) + 1;
      const end = b > a && v[b - 1] === "\n" ? b - 1 : b;
      const block = v.slice(start, end);
      const next = e.shiftKey ? block.replace(/^ {1,2}/gm, "") : block.replace(/^/gm, "  ");
      ta.setSelectionRange(start, end);
      insertText(ta, next);
      ta.setSelectionRange(start, start + next.length);
      return;
    }
    if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      const { selectionStart: a, selectionEnd: b, value: v } = ta;
      if (a !== b) return;
      const lineStart = v.lastIndexOf("\n", a - 1) + 1;
      const indent = v.slice(lineStart, a).match(/^[ \t]*/)[0];
      const before = v.slice(lineStart, a).trimEnd().slice(-1);
      const after = v.slice(a).match(/^[ \t]*(.)?/)?.[1];
      const opens = before === "{" || before === "[" || (before === ">" && lang !== "json" && !/<\/[^>]*>$|\/>$/.test(v.slice(lineStart, a).trimEnd()));
      e.preventDefault();
      if (opens && ((before === "{" && after === "}") || (before === "[" && after === "]"))) {
        insertText(ta, `\n${indent}  \n${indent}`);
        const pos = a + 1 + indent.length + 2;
        ta.setSelectionRange(pos, pos);
      } else {
        insertText(ta, `\n${indent}${opens ? "  " : ""}`);
      }
    }
  });

  paint();
  return {
    get value() {
      return ta.value;
    },
    set(v) {
      if (ta.value === v) return;
      ta.value = v;
      paint();
    },
    setLanguage(l) {
      lang = l;
      paint();
    },
    setVars(v) {
      varMap = v;
      paint();
    },
    repaint: paint,
    focus() {
      ta.focus({ preventScroll: true });
    },
    textarea: ta,
  };
}
