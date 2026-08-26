// KNK-90: 진짜 위지위그(WYSIWYG) 마크다운 에디터.
// TipTap(ProseMirror) 기반 — 편집하는 그 자리에서 서식이 바로 적용돼 보인다(Typora/노션식).
// 저장은 여전히 순수 마크다운으로 하고(getMarkdown), 불러올 때도 마크다운을 파싱한다.
// 한글/일본어 IME 조합은 ProseMirror 가 안전하게 처리한다.
//
// 제공 기능
//  - "/" 슬래시 명령 메뉴(제목·목록·인용·코드·구분선·이미지·링크 등)
//  - 편집 포커스 중 노출되는 서식 툴바(선택에 즉시 서식)
//  - 링크/이미지 URL 은 브라우저 blocking 다이얼로그 대신 인라인 입력창으로 받는다.

import { Editor, Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Suggestion from "@tiptap/suggestion";
import { Markdown } from "tiptap-markdown";
import { t } from "./i18n.js";

// 커서 근처에 뜨는 인라인 URL 입력창. Promise<string|null> 을 돌려준다(Enter=값, Esc/바깥=취소).
// 브라우저 alert/prompt 는 웹뷰를 멈추므로 쓰지 않는다.
function promptInline(rect, label) {
  return new Promise((resolve) => {
    const box = document.createElement("div");
    box.className = "md-inline-prompt";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = label;
    box.appendChild(input);
    document.body.appendChild(box);
    const x = Math.min(rect.left, window.innerWidth - 260);
    const y = Math.min(rect.bottom + 4, window.innerHeight - 44);
    box.style.left = `${Math.max(8, x)}px`;
    box.style.top = `${y}px`;
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      box.remove();
      resolve(val);
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); finish(input.value.trim() || null); }
      else if (e.key === "Escape") { e.preventDefault(); finish(null); }
    });
    input.addEventListener("blur", () => setTimeout(() => finish(null), 100));
    input.focus();
  });
}

// 현재 커서(또는 선택 시작)의 화면 좌표.
function caretRect(editor) {
  try {
    const { from } = editor.state.selection;
    return editor.view.coordsAtPos(from);
  } catch {
    return editor.view.dom.getBoundingClientRect();
  }
}

// 슬래시 메뉴 + 툴바가 공유하는 명령 정의. isActive 는 툴바 강조용(선택).
const COMMANDS = [
  { id: "h1", icon: "H1", key: "md.h1", keys: ["h1", "heading", "제목", "見出し", "标题"],
    run: (e, r) => chain(e, r).toggleHeading({ level: 1 }).run(), active: (e) => e.isActive("heading", { level: 1 }) },
  { id: "h2", icon: "H2", key: "md.h2", keys: ["h2", "heading", "제목", "見出し", "标题"],
    run: (e, r) => chain(e, r).toggleHeading({ level: 2 }).run(), active: (e) => e.isActive("heading", { level: 2 }) },
  { id: "h3", icon: "H3", key: "md.h3", keys: ["h3", "heading", "제목", "見出し", "标题"],
    run: (e, r) => chain(e, r).toggleHeading({ level: 3 }).run(), active: (e) => e.isActive("heading", { level: 3 }) },
  { id: "bold", icon: "B", key: "md.bold", keys: ["bold", "굵게", "강조", "太字", "加粗"],
    run: (e, r) => chain(e, r).toggleBold().run(), active: (e) => e.isActive("bold") },
  { id: "italic", icon: "I", key: "md.italic", keys: ["italic", "기울임", "斜体"],
    run: (e, r) => chain(e, r).toggleItalic().run(), active: (e) => e.isActive("italic") },
  { id: "strike", icon: "S", key: "md.strike", keys: ["strike", "취소선", "打消", "删除线"],
    run: (e, r) => chain(e, r).toggleStrike().run(), active: (e) => e.isActive("strike") },
  { id: "ul", icon: "•", key: "md.bulletList", keys: ["list", "bullet", "목록", "リスト", "列表"],
    run: (e, r) => chain(e, r).toggleBulletList().run(), active: (e) => e.isActive("bulletList") },
  { id: "ol", icon: "1.", key: "md.numberedList", keys: ["number", "ordered", "번호", "番号", "有序"],
    run: (e, r) => chain(e, r).toggleOrderedList().run(), active: (e) => e.isActive("orderedList") },
  { id: "todo", icon: "☑", key: "md.todo", keys: ["todo", "task", "check", "체크", "할일", "タスク", "待办"],
    run: (e, r) => chain(e, r).toggleTaskList().run(), active: (e) => e.isActive("taskList") },
  { id: "quote", icon: "❝", key: "md.quote", keys: ["quote", "인용", "引用"],
    run: (e, r) => chain(e, r).toggleBlockquote().run(), active: (e) => e.isActive("blockquote") },
  { id: "code", icon: "</>", key: "md.codeBlock", keys: ["code", "코드", "コード", "代码"],
    run: (e, r) => chain(e, r).toggleCodeBlock().run(), active: (e) => e.isActive("codeBlock") },
  { id: "divider", icon: "―", key: "md.divider", keys: ["divider", "hr", "구분선", "区切", "分割"],
    run: (e, r) => chain(e, r).setHorizontalRule().run() },
  { id: "link", icon: "🔗", key: "md.link", keys: ["link", "링크", "リンク", "链接"], run: insertLink },
  { id: "image", icon: "🖼", key: "md.image", keys: ["image", "img", "이미지", "사진", "画像", "图片"], run: insertImage },
];

// 슬래시로 부른 경우 range(트리거 "/query")를 먼저 지운 뒤 명령을 잇는다.
function chain(editor, range) {
  const c = editor.chain().focus();
  return range ? c.deleteRange(range) : c;
}

async function insertLink(editor, range) {
  if (range) editor.chain().focus().deleteRange(range).run();
  const url = await promptInline(caretRect(editor), t("md.phUrl"));
  if (!url) return;
  const { empty } = editor.state.selection;
  if (empty) {
    editor.chain().focus().insertContent({ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] }).run();
  } else {
    editor.chain().focus().setLink({ href: url }).run();
  }
}

async function insertImage(editor, range) {
  if (range) editor.chain().focus().deleteRange(range).run();
  const url = await promptInline(caretRect(editor), t("md.phUrl"));
  if (!url) return;
  editor.chain().focus().setImage({ src: url }).run();
}

// "/" 슬래시 명령 확장: TipTap Suggestion 으로 메뉴를 띄운다(외부 팝업 라이브러리 없이 직접 DOM).
function makeSlashExtension() {
  return Extension.create({
    name: "slashCommand",
    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          char: "/",
          allowSpaces: false,
          startOfLine: false,
          command: ({ editor, range, props }) => props.run(editor, range),
          items: ({ query }) => {
            const q = query.trim().toLowerCase();
            if (!q) return COMMANDS.slice();
            return COMMANDS.filter((c) =>
              t(c.key).toLowerCase().includes(q) || c.keys.some((k) => k.toLowerCase().includes(q)));
          },
          render: () => {
            let el, items = [], active = 0, command, rect;
            const paint = () => {
              el.innerHTML = "";
              if (!items.length) {
                const empty = document.createElement("div");
                empty.className = "md-slash-empty";
                empty.textContent = t("md.noResults");
                el.appendChild(empty);
                return;
              }
              items.forEach((c, i) => {
                const item = document.createElement("div");
                item.className = "md-slash-item" + (i === active ? " active" : "");
                item.innerHTML = `<span class="md-slash-icon">${c.icon}</span><span class="md-slash-label"></span>`;
                item.querySelector(".md-slash-label").textContent = t(c.key);
                item.addEventListener("mousedown", (e) => { e.preventDefault(); command(c); });
                item.addEventListener("mousemove", () => { if (active !== i) { active = i; paint(); } });
                el.appendChild(item);
              });
            };
            const place = () => {
              if (!rect) return;
              let x = rect.left;
              let y = rect.bottom + 4;
              const mw = el.offsetWidth || 220;
              const mh = el.offsetHeight || 200;
              if (x + mw > window.innerWidth - 8) x = window.innerWidth - mw - 8;
              if (y + mh > window.innerHeight - 8) y = rect.top - mh - 4;
              el.style.left = `${Math.round(Math.max(8, x))}px`;
              el.style.top = `${Math.round(Math.max(8, y))}px`;
            };
            return {
              onStart: (props) => {
                items = props.items; active = 0; command = props.command;
                rect = props.clientRect?.();
                el = document.createElement("div");
                el.className = "md-slash-menu";
                document.body.appendChild(el);
                paint(); place();
              },
              onUpdate: (props) => {
                items = props.items; command = props.command;
                if (active >= items.length) active = 0;
                rect = props.clientRect?.();
                paint(); place();
              },
              onKeyDown: (props) => {
                const key = props.event.key;
                if (key === "ArrowDown") { active = items.length ? (active + 1) % items.length : 0; paint(); return true; }
                if (key === "ArrowUp") { active = items.length ? (active - 1 + items.length) % items.length : 0; paint(); return true; }
                if (key === "Enter" || key === "Tab") { if (items[active]) command(items[active]); return true; }
                if (key === "Escape") { return true; }
                return false;
              },
              onExit: () => { el?.remove(); el = null; },
            };
          },
        }),
      ];
    },
  });
}

// 서식 툴바를 만들고 에디터와 연결한다. 포커스 중에만 노출.
function makeToolbar(editor) {
  const bar = document.createElement("div");
  bar.className = "md-toolbar";
  bar.hidden = true;
  const btns = [];
  for (const c of COMMANDS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "md-tb-btn";
    b.dataset.cmd = c.id;
    b.textContent = c.icon;
    b.title = t(c.key);
    b.addEventListener("mousedown", (e) => e.preventDefault()); // 포커스 유지(=blur 저장 방지)
    b.addEventListener("click", () => c.run(editor));
    bar.appendChild(b);
    btns.push({ b, c });
  }
  const sync = () => {
    for (const { b, c } of btns) b.classList.toggle("is-active", !!c.active?.(editor));
  };
  editor.on("selectionUpdate", sync);
  editor.on("transaction", sync);
  return { bar, sync };
}

// 컨테이너에 위지위그 에디터를 마운트한다.
//  opts: { markdown, placeholder, onBlur(md), autofocus, toolbar, editable }
export function mountMarkdownEditor(container, opts = {}) {
  const { markdown = "", placeholder = "", onBlur, autofocus = false, toolbar = true, editable = true } = opts;

  const wrap = document.createElement("div");
  wrap.className = "md-wysiwyg";
  const mount = document.createElement("div");
  container.appendChild(wrap);

  const editor = new Editor({
    element: mount,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      Placeholder.configure({ placeholder: placeholder || t("md.slashHint") }),
      Image,
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({ html: false, breaks: true, linkify: true, transformPastedText: true, transformCopiedText: true }),
      makeSlashExtension(),
    ],
    content: markdown,
    editable,
    autofocus,
  });

  let bar = null;
  if (toolbar && editable) {
    const tb = makeToolbar(editor);
    bar = tb.bar;
    wrap.appendChild(bar);
  }
  wrap.appendChild(mount);

  editor.on("focus", () => { if (bar) bar.hidden = false; });
  editor.on("blur", ({ event }) => {
    // 툴바/슬래시메뉴/인라인 프롬프트로 옮겨간 포커스면 저장하지 않는다.
    const to = event?.relatedTarget;
    if (to && (wrap.contains(to) || to.closest?.(".md-slash-menu, .md-inline-prompt"))) return;
    if (bar) bar.hidden = true;
    onBlur?.(getMarkdown());
  });

  function getMarkdown() {
    return editor.storage.markdown.getMarkdown();
  }
  function setMarkdown(md) {
    editor.commands.setContent(md || "");
  }

  return {
    editor,
    getMarkdown,
    setMarkdown,
    focus: () => editor.commands.focus("end"),
    destroy: () => { editor.destroy(); wrap.remove(); },
  };
}
