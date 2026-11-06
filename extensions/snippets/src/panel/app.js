// Snippets panel: a small view controller that re-renders from `state` + `ui`.
import { escapeHtml as esc, cls } from "@muxy/ui";
import * as C from "@/lib/core.js";
import * as B from "@/lib/bridge.js";
import { svg } from "@/lib/icons.js";

const ACTION_LABELS = { run: "Run", insert: "Insert only", tab: "New tab" };

const highlight = (cmd) => esc(cmd).replace(/\{\{[^}]*\}\}/g, (m) => `<span class="sn-var">${m}</span>`);
const varCount = (n) => (n === 1 ? "1 var" : `${n} vars`);

export class SnippetsPanel {
  constructor(root) {
    this.root = root;
    this.state = C.emptyState();
    this.ui = {
      view: "list", // list | edit | vars | groups | io
      q: "",
      group: "all",
      collapsed: new Set(),
      target: "focused",
      panes: [],
      draft: null, // snippet being edited
      run: null, // { id, action, values, error }
      io: { text: "", mode: "merge" },
      notice: null, // { kind: "ok" | "error", text }
    };
    this.menu = null;
    this.noticeTimer = null;
    this.clickTimer = null;
  }

  async start() {
    this.bindEvents();
    try {
      this.state = await B.load();
    } catch (err) {
      this.ui.notice = { kind: "error", text: `Could not load snippets: ${err.message}` };
    }
    this.render();
    this.refreshPanes();
  }

  // ---------- helpers ----------

  $(id) {
    return this.root.ownerDocument.getElementById(id);
  }

  byId(id) {
    return this.state.snippets.find((s) => s.id === id);
  }

  notify(kind, text) {
    this.ui.notice = { kind, text };
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      this.ui.notice = null;
      this.renderNotice();
    }, kind === "error" ? 6000 : 2500);
    this.renderNotice();
  }

  async persist(next) {
    this.state = C.normalize(next);
    try {
      await B.save(this.state);
    } catch (err) {
      this.notify("error", `Could not save: ${err.message}`);
    }
  }

  async refreshPanes() {
    this.ui.panes = await B.listPanes();
    if (this.ui.target !== "focused" && !this.ui.panes.some((p) => p.id === this.ui.target)) this.ui.target = "focused";
    const select = this.$("target");
    if (select && this.root.ownerDocument.activeElement !== select) select.outerHTML = this.targetSelect();
  }

  refreshResults() {
    const el = this.$("results");
    if (el) el.innerHTML = this.resultsHTML();
  }

  // ---------- rendering ----------

  render() {
    this.closeMenu();
    const views = { list: this.viewList, edit: this.viewEdit, vars: this.viewVars, groups: this.viewGroups, io: this.viewIO };
    this.root.innerHTML = (views[this.ui.view] || this.viewList).call(this);
    this.afterRender();
  }

  noticeHTML() {
    const n = this.ui.notice;
    return n ? `<div class="sn-notice ${n.kind === "error" ? "is-error" : ""}" role="status">${esc(n.text)}</div>` : "";
  }

  renderNotice() {
    const el = this.$("notice-slot");
    if (el) el.innerHTML = this.noticeHTML();
  }

  subHeader(title, right = "") {
    return (
      `<div class="mx-toolbar sn-bar-top">` +
      `<button class="mx-icon-btn" data-act="back" aria-label="Back" title="Back (Esc)">${svg("chevronLeft")}</button>` +
      `<span class="sn-title">${esc(title)}</span><span class="mx-spacer"></span>${right}</div>` +
      `<div id="notice-slot">${this.noticeHTML()}</div>`
    );
  }

  viewList() {
    const counts = C.counts(this.state);
    const groupOptions = [`<option value="all">All groups</option>`]
      .concat(this.state.groups.map((g) => `<option value="${esc(g.id)}">${esc(g.name)} (${counts[g.id] || 0})</option>`))
      .concat(counts[C.UNGROUPED] ? [`<option value="${C.UNGROUPED}">Ungrouped (${counts[C.UNGROUPED]})</option>`] : [])
      .map((o) => o.replace(`value="${esc(this.ui.group)}"`, `value="${esc(this.ui.group)}" selected`))
      .join("");
    const total = this.state.snippets.length;
    return (
      `<div class="mx-toolbar sn-bar-top">` +
      `<label class="sn-search"><span class="sr-only">Search snippets</span>${svg("search", 12)}` +
      `<input id="q" type="search" placeholder="Search ${total ? total + " " : ""}snippets…" value="${esc(this.ui.q)}" autocomplete="off" spellcheck="false"></label>` +
      `<label class="sr-only" for="group-filter">Filter by group</label>` +
      `<select class="mx-select sn-group-filter" id="group-filter">${groupOptions}</select>` +
      `<button class="mx-icon-btn" data-act="new" aria-label="New snippet" title="New snippet">${svg("plus")}</button>` +
      `</div>` +
      `<div id="notice-slot">${this.noticeHTML()}</div>` +
      `<div class="mx-list sn-results" id="results">${this.resultsHTML()}</div>` +
      `<div class="mx-toolbar sn-bar-bottom">` +
      `<span class="sn-target-icon" aria-hidden="true">${svg("terminal", 12)}</span>` +
      `<label for="target" class="sr-only">Send to</label>${this.targetSelect()}` +
      `<button class="mx-icon-btn" data-act="groups" aria-label="Manage groups" title="Manage groups">${svg("folder")}</button>` +
      `<button class="mx-icon-btn" data-act="io" aria-label="Import or export" title="Import / Export">${svg("importExport")}</button>` +
      `</div>`
    );
  }

  targetSelect() {
    const { panes, target } = this.ui;
    return (
      `<select class="mx-select sn-grow" id="target" title="Where snippets are sent">` +
      `<option value="focused"${target === "focused" ? " selected" : ""}>Focused terminal</option>` +
      panes
        .map(
          (p) =>
            `<option value="${esc(p.id)}"${target === p.id ? " selected" : ""}>${esc(p.title || "Terminal")}` +
            `${p.workingDirectory ? " — " + esc(p.workingDirectory) : ""}</option>`,
        )
        .join("") +
      `</select>`
    );
  }

  resultsHTML() {
    if (!this.state.snippets.length) {
      return (
        `<div class="mx-empty">` +
        `<div class="mx-empty-title">No snippets yet</div>` +
        `<div class="mx-empty-copy">Save the commands you type often and run them in any terminal with one click.</div>` +
        `<button class="mx-btn mx-btn-primary" data-act="new">${svg("plus")}Add your first snippet</button>` +
        `</div>`
      );
    }
    const sections = C.sections(this.state, this.ui.q, this.ui.group);
    if (!sections.length) {
      return `<div class="mx-empty"><div class="mx-empty-copy">No snippets match “${esc(this.ui.q)}”.</div></div>`;
    }
    return sections
      .map((sec) => {
        const open = this.ui.q || !this.ui.collapsed.has(sec.group.id);
        return (
          `<section class="sn-section">` +
          `<button class="mx-section-label sn-section-head" data-act="collapse" data-id="${esc(sec.group.id)}" aria-expanded="${!!open}">` +
          `${svg("chevronDown", 12)}<span class="sn-dot" style="background:${esc(sec.group.color)}"></span>` +
          `${esc(sec.group.name)}<span class="sn-count">${sec.items.length}</span></button>` +
          (open ? sec.items.map((s) => this.rowHTML(s)).join("") : "") +
          `</section>`
        );
      })
      .join("");
  }

  rowHTML(s) {
    const nVars = C.parseVars(s.command).length;
    const lines = C.splitLines(s.command);
    const runLabel = s.action === "tab" ? "Run in new tab" : "Run";
    return (
      `<div class="mx-row sn-snippet" data-id="${esc(s.id)}">` +
      `<button class="sn-body" data-act="edit" data-id="${esc(s.id)}" title="Click to edit · double-click: ${esc(ACTION_LABELS[s.action])} · right-click for more">` +
      `<span class="sn-name"><span class="sn-name-text">${esc(s.name)}</span>` +
      (nVars ? `<span class="mx-badge">${varCount(nVars)}</span>` : "") +
      (lines.length > 1 ? `<span class="mx-badge mx-badge-accent">${lines.length} lines</span>` : "") +
      `</span><span class="mx-row-sub sn-mono">${highlight(lines.join(" ⏎ "))}</span></button>` +
      `<span class="sn-actions">` +
      `<button class="mx-icon-btn" data-act="insert" data-id="${esc(s.id)}" aria-label="Insert ${esc(s.name)} without running" title="Insert (don’t run)">${svg("insert")}</button>` +
      `<button class="mx-icon-btn sn-run" data-act="run" data-id="${esc(s.id)}" aria-label="${runLabel} ${esc(s.name)}" title="${runLabel}">${svg(s.action === "tab" ? "tab" : "play")}</button>` +
      `</span></div>`
    );
  }

  viewEdit() {
    const d = this.ui.draft;
    const isNew = !d.id;
    const right = isNew
      ? ""
      : `<button class="mx-icon-btn" data-act="duplicate" aria-label="Duplicate" title="Duplicate">${svg("copy")}</button>` +
        `<button class="mx-icon-btn sn-danger" data-act="delete" aria-label="Delete" title="Delete">${svg("trash")}</button>`;
    return (
      this.subHeader(isNew ? "New snippet" : "Edit snippet", right) +
      `<form class="sn-form" id="edit-form" novalidate>` +
      `<div class="sn-field"><label for="f-name">Name</label>` +
      `<input class="mx-input" id="f-name" data-draft="name" value="${esc(d.name)}" placeholder="e.g. Follow service logs" autocomplete="off"></div>` +
      `<div class="sn-field"><label for="f-cmd">Command</label>` +
      `<textarea class="mx-textarea sn-code" id="f-cmd" data-draft="command" rows="5" spellcheck="false" ` +
      `placeholder="cd ~/projects/web-app&#10;docker compose logs -f {{service}}">${esc(d.command)}</textarea>` +
      `<span class="sn-hint">Each line runs in order. Use <span class="sn-mono sn-var">{{name}}</span> or ` +
      `<span class="sn-mono sn-var">{{name:default}}</span> for values asked at run time.</span>` +
      `<span class="sn-error" id="cmd-error"></span>` +
      `<div class="sn-chips" id="vars-detected">${this.varsDetected(C.parseVars(d.command))}</div></div>` +
      `<div class="sn-row-2">` +
      `<div class="sn-field"><label for="f-group">Group</label><select class="mx-select" id="f-group" data-draft="groupId">` +
      `<option value=""${!d.groupId ? " selected" : ""}>Ungrouped</option>` +
      this.state.groups.map((g) => `<option value="${esc(g.id)}"${d.groupId === g.id ? " selected" : ""}>${esc(g.name)}</option>`).join("") +
      `<option value="__new"${d.groupId === "__new" ? " selected" : ""}>+ New group…</option></select></div>` +
      `<div class="sn-field" id="new-group-field"${d.groupId === "__new" ? "" : " hidden"}><label for="f-newgroup">New group name</label>` +
      `<input class="mx-input" id="f-newgroup" data-draft="newGroup" value="${esc(d.newGroup || "")}" autocomplete="off"></div>` +
      `</div>` +
      `<div class="sn-field"><span class="sn-label" id="action-label">Default action</span>` +
      `<div class="mx-segmented sn-segmented" role="radiogroup" aria-labelledby="action-label">` +
      Object.entries(ACTION_LABELS)
        .map(
          ([value, label]) =>
            `<button type="button" role="radio" class="${cls("mx-segmented-btn", { "is-active": d.action === value })}" ` +
            `aria-checked="${d.action === value}" data-act="set-action" data-value="${value}">${label}</button>`,
        )
        .join("") +
      `</div><span class="sn-hint">Used for double-click and for Quick run (⌘⌥S).</span></div>` +
      `<div class="sn-field"><label for="f-desc">Note <span class="sn-hint">(optional)</span></label>` +
      `<input class="mx-input" id="f-desc" data-draft="description" value="${esc(d.description || "")}" placeholder="When to use it" autocomplete="off"></div>` +
      `<div id="secret-slot">${this.secretHTML(C.looksSecret(d.command))}</div>` +
      `</form>` +
      `<div class="mx-toolbar sn-bar-bottom sn-actions-bar">` +
      `<button class="mx-btn mx-btn-ghost" data-act="back">Cancel</button><span class="mx-spacer"></span>` +
      `<button class="mx-btn mx-btn-primary" data-act="save" aria-keyshortcuts="Meta+Enter" title="Save (⌘↵)">Save snippet` +
      `<kbd class="sn-keys" aria-hidden="true"><span>⌘</span><span>↵</span></kbd></button></div>`
    );
  }

  varsDetected(vars) {
    return vars.map((v) => `<span class="mx-badge sn-mono">${esc(v.name)}${v.def ? " = " + esc(v.def) : ""}</span>`).join("");
  }

  secretHTML(what) {
    if (!what) return "";
    return (
      `<div class="sn-warn">${svg("lock")}<span>This looks like it contains ${esc(what)}. Snippets are stored as plain JSON — ` +
      `use a variable such as <span class="sn-mono">{{password}}</span> and type it at run time instead.</span></div>`
    );
  }

  viewVars() {
    const s = this.byId(this.ui.run.id);
    if (!s) {
      this.ui.view = "list";
      return this.viewList();
    }
    const vars = C.parseVars(s.command);
    const label = ACTION_LABELS[this.ui.run.action];
    return (
      this.subHeader(s.name) +
      `<form class="sn-form" id="vars-form" novalidate>` +
      `<div class="sn-preview" id="vars-preview">${esc(C.fill(s.command, this.ui.run.values))}</div>` +
      vars
        .map(
          (v, i) =>
            `<div class="sn-field"><label for="v-${i}" class="sn-mono">${esc(v.name)}</label>` +
            `<input class="mx-input sn-code" id="v-${i}" data-var="${esc(v.name)}"${C.isSensitiveVar(v.name) ? ' type="password"' : ""} ` +
            `value="${esc(this.ui.run.values[v.name] || "")}" placeholder="${esc(v.def || "required")}" autocomplete="off" spellcheck="false"></div>`,
        )
        .join("") +
      `<span class="sn-hint">Enter: ${esc(label)} · ⌥↵ insert · ⌘↵ new tab. Values are remembered per snippet, ` +
      `except names containing pass, secret, token or key.</span>` +
      `<span class="sn-error" id="vars-error">${esc(this.ui.run.error || "")}</span>` +
      `</form>` +
      `<div class="mx-toolbar sn-bar-bottom sn-actions-bar">` +
      `<button class="mx-btn" data-act="var-go" data-action="tab">${svg("tab")}New tab</button>` +
      `<span class="mx-spacer"></span>` +
      `<button class="mx-btn" data-act="var-go" data-action="insert">${svg("insert")}Insert</button>` +
      `<button class="mx-btn mx-btn-primary" data-act="var-go" data-action="run">${svg("play")}Run</button></div>`
    );
  }

  viewGroups() {
    const groups = this.state.groups;
    return (
      this.subHeader("Groups", `<button class="mx-btn" data-act="group-add">${svg("plus")}Add group</button>`) +
      `<div class="sn-form">` +
      (groups.length ? "" : `<div class="mx-empty"><div class="mx-empty-copy">No groups yet.</div></div>`) +
      groups
        .map(
          (g, i) =>
            `<div class="sn-group-row">` +
            `<div class="sn-group-line">` +
            `<span class="sn-dot" style="background:${esc(g.color)}"></span>` +
            `<label class="sr-only" for="g-${i}">Group name</label>` +
            `<input class="mx-input sn-grow" id="g-${i}" data-group-name="${esc(g.id)}" value="${esc(g.name)}" autocomplete="off">` +
            `<button class="mx-icon-btn" data-act="group-up" data-id="${esc(g.id)}" aria-label="Move up"${i === 0 ? " disabled" : ""}>${svg("chevronUp")}</button>` +
            `<button class="mx-icon-btn" data-act="group-down" data-id="${esc(g.id)}" aria-label="Move down"${i === groups.length - 1 ? " disabled" : ""}>${svg("chevronDown")}</button>` +
            `<button class="mx-icon-btn sn-danger" data-act="group-del" data-id="${esc(g.id)}" aria-label="Delete group ${esc(g.name)}">${svg("trash")}</button>` +
            `</div>` +
            `<div class="sn-swatches" role="group" aria-label="Color for ${esc(g.name)}">` +
            C.COLORS.map(
              (c) =>
                `<button class="sn-swatch" data-act="group-color" data-id="${esc(g.id)}" data-color="${c}" style="background:${c}" ` +
                `aria-label="Color ${c}" aria-pressed="${g.color === c}"></button>`,
            ).join("") +
            `</div></div>`,
        )
        .join("") +
      `</div>`
    );
  }

  viewIO() {
    return (
      this.subHeader("Import / Export") +
      `<div class="sn-form">` +
      `<div class="sn-field"><label for="io-export">Export — copy and keep it somewhere safe</label>` +
      `<textarea class="mx-textarea sn-code" id="io-export" rows="6" readonly>${esc(C.exportJSON(this.state))}</textarea>` +
      `<div><button class="mx-btn" data-act="copy-export">${svg("copy")}Copy JSON</button></div></div>` +
      `<div class="sn-field"><label for="io-import">Import — paste exported JSON</label>` +
      `<textarea class="mx-textarea sn-code" id="io-import" rows="6" spellcheck="false" placeholder="{ &quot;groups&quot;: [...], &quot;snippets&quot;: [...] }">${esc(this.ui.io.text)}</textarea></div>` +
      `<div class="sn-field"><span class="sn-label" id="io-mode-label">Import mode</span>` +
      `<div class="mx-segmented sn-segmented" role="radiogroup" aria-labelledby="io-mode-label">` +
      [
        ["merge", "Merge"],
        ["replace", "Replace all"],
      ]
        .map(
          ([value, label]) =>
            `<button type="button" role="radio" class="${cls("mx-segmented-btn", { "is-active": this.ui.io.mode === value })}" ` +
            `aria-checked="${this.ui.io.mode === value}" data-act="io-mode" data-value="${value}">${label}</button>`,
        )
        .join("") +
      `</div><span class="sn-hint">Merge matches groups by name and snippets by ID.</span></div>` +
      `<div><button class="mx-btn mx-btn-primary" data-act="import">Import</button></div>` +
      `</div>`
    );
  }

  afterRender() {
    if (this.ui.view === "edit") {
      const el = this.$(this.ui.draft.id ? "f-cmd" : "f-name");
      if (el) el.focus();
    } else if (this.ui.view === "vars") {
      const inputs = Array.from(this.root.querySelectorAll("[data-var]"));
      const target = inputs.find((x) => !x.value) || inputs[0];
      if (target) target.focus();
    }
  }

  // ---------- actions ----------

  backToList() {
    this.ui.view = "list";
    this.ui.draft = null;
    this.ui.run = null;
    this.render();
  }

  startRun(s, action) {
    if (C.parseVars(s.command).length) {
      this.ui.run = { id: s.id, action, values: C.initialValues(s), error: "" };
      this.ui.view = "vars";
      this.render();
      return;
    }
    this.send(s, {}, action);
  }

  async send(s, values, action) {
    const missing = C.missingVars(s.command, values);
    if (missing.length) {
      if (this.ui.run) this.ui.run.error = `Fill in: ${missing.join(", ")}`;
      const el = this.$("vars-error");
      if (el) el.textContent = this.ui.run.error;
      return;
    }
    try {
      const res = await B.execute(s, values, action, this.ui.target);
      await this.persist(C.recordUse(this.state, s.id, values));
      const verb = action === "insert" ? "Inserted" : action === "tab" ? "Opened" : "Ran";
      B.toast(`${verb} “${s.name}”`, `in ${res.where}`);
      if (this.ui.view !== "list") this.backToList();
      this.notify("ok", `${verb} “${s.name}” in ${res.where}`);
    } catch (err) {
      this.notify("error", err.message || String(err));
    }
  }

  openEditor(s) {
    const { group } = this.ui;
    const defaultGroup = group !== "all" && group !== C.UNGROUPED ? group : this.state.groups[0]?.id || "";
    this.ui.draft = s
      ? { id: s.id, name: s.name, command: s.command, groupId: s.groupId || "", action: s.action, description: s.description || "", newGroup: "" }
      : { id: null, name: "", command: "", groupId: defaultGroup, action: "run", description: "", newGroup: "" };
    this.ui.view = "edit";
    this.render();
  }

  async saveDraft() {
    const d = this.ui.draft;
    if (!d.command.trim()) {
      this.$("cmd-error").textContent = "A command is required.";
      this.$("f-cmd").focus();
      return;
    }
    const secret = C.looksSecret(d.command);
    if (secret && !(await B.confirm("Save a possible secret?", `This command looks like it contains ${secret}. Snippets are stored unencrypted.`, "Save anyway"))) {
      return;
    }
    let next = this.state;
    let groupId = d.groupId || null;
    if (groupId === "__new") {
      const added = C.addGroup(next, d.newGroup || "New group");
      next = added.state;
      groupId = added.group.id;
    }
    const r = C.upsertSnippet(next, { id: d.id || undefined, name: d.name, command: d.command, groupId, action: d.action, description: d.description });
    await this.persist(r.state);
    this.backToList();
    this.notify("ok", `Saved “${r.snippet.name}”`);
  }

  async deleteSnippet(s) {
    if (!s) return;
    if (!(await B.confirm(`Delete “${s.name}”?`, "This cannot be undone.", "Delete"))) return;
    await this.persist(C.deleteSnippet(this.state, s.id));
    if (this.ui.view !== "list") this.backToList();
    else this.refreshResults();
    this.notify("ok", `Deleted “${s.name}”`);
  }

  async duplicate(id, thenEdit) {
    const r = C.duplicateSnippet(this.state, id);
    await this.persist(r.state);
    if (thenEdit) this.openEditor(this.byId(r.snippet.id));
    else this.refreshResults();
    return r.snippet;
  }

  // ---------- context menu ----------

  rowFor(id) {
    return Array.from(this.root.querySelectorAll(".sn-snippet")).find((r) => r.dataset.id === id) || null;
  }

  openMenu(id, x, y) {
    const s = this.byId(id);
    if (!s) return;
    this.closeMenu();
    const doc = this.root.ownerDocument;
    const items = [
      ["run", "play", "Run"],
      ["insert", "insert", "Insert (don’t run)"],
      ["tab", "tab", "Run in new tab"],
      "-",
      ["edit", "pencil", "Edit"],
      ["duplicate", "copy", "Duplicate"],
      ["copy", "clipboard", "Copy command"],
      "-",
      ["delete", "trash", "Delete", true],
    ];
    const menu = doc.createElement("div");
    menu.className = "mx-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", s.name);
    menu.dataset.id = id;
    menu.innerHTML = items
      .map((it) =>
        it === "-"
          ? `<div class="mx-menu-separator" role="separator"></div>`
          : `<button class="${cls("mx-menu-item", { "is-danger": it[3] })}" role="menuitem" tabindex="-1" data-menu="${it[0]}">${svg(it[1])}${esc(it[2])}</button>`,
      )
      .join("");
    doc.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const win = doc.defaultView;
    menu.style.left = `${Math.max(4, Math.min(x, win.innerWidth - rect.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, win.innerHeight - rect.height - 4))}px`;
    this.rowFor(id)?.classList.add("is-selected");
    menu.querySelector("[data-menu]").focus();
    menu.addEventListener("click", (e) => this.onMenuClick(e));
    menu.addEventListener("keydown", (e) => this.onMenuKey(e));
    this.menu = menu;
  }

  closeMenu(restoreFocus) {
    if (!this.menu) return;
    const id = this.menu.dataset.id;
    this.menu.remove();
    this.menu = null;
    this.root.querySelector(".sn-snippet.is-selected")?.classList.remove("is-selected");
    if (restoreFocus) this.rowFor(id)?.querySelector(".sn-body")?.focus();
  }

  async onMenuClick(e) {
    const btn = e.target.closest("[data-menu]");
    if (!btn || !this.menu) return;
    const s = this.byId(this.menu.dataset.id);
    const act = btn.dataset.menu;
    this.closeMenu();
    if (!s) return;
    switch (act) {
      case "run":
      case "insert":
      case "tab":
        return this.startRun(s, act);
      case "edit":
        return this.openEditor(s);
      case "duplicate":
        await this.duplicate(s.id, false);
        return this.notify("ok", `Duplicated “${s.name}”`);
      case "copy":
        try {
          await navigator.clipboard.writeText(s.command);
          this.notify("ok", "Command copied");
        } catch (err) {
          this.notify("error", `Could not copy: ${err.message}`);
        }
        return;
      case "delete":
        return this.deleteSnippet(s);
    }
  }

  onMenuKey(e) {
    const items = Array.from(this.menu.querySelectorAll("[data-menu]"));
    const i = items.indexOf(this.root.ownerDocument.activeElement);
    const focus = (n) => items[(n + items.length) % items.length].focus();
    if (e.key === "ArrowDown") (e.preventDefault(), focus(i + 1));
    else if (e.key === "ArrowUp") (e.preventDefault(), focus(i - 1));
    else if (e.key === "Home") (e.preventDefault(), focus(0));
    else if (e.key === "End") (e.preventDefault(), focus(items.length - 1));
    else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      this.closeMenu(true);
    }
  }

  // ---------- events ----------

  bindEvents() {
    const doc = this.root.ownerDocument;
    const win = doc.defaultView;
    this.root.addEventListener("click", (e) => this.onClick(e));
    this.root.addEventListener("dblclick", (e) => this.onDblClick(e));
    this.root.addEventListener("input", (e) => this.onInput(e));
    this.root.addEventListener("change", (e) => this.onChange(e));
    this.root.addEventListener("submit", (e) => e.preventDefault());
    this.root.addEventListener("contextmenu", (e) => {
      const row = e.target.closest(".sn-snippet");
      if (!row) return;
      e.preventDefault();
      this.openMenu(row.dataset.id, e.clientX, e.clientY);
    });
    this.root.addEventListener("mousedown", (e) => {
      if (e.target.id === "target") this.refreshPanes();
    });
    this.root.addEventListener("scroll", () => this.closeMenu(), true);
    doc.addEventListener("mousedown", (e) => {
      if (this.menu && !this.menu.contains(e.target)) this.closeMenu();
    }, true);
    doc.addEventListener("keydown", (e) => this.onKeyDown(e));
    win.addEventListener("blur", () => this.closeMenu());
    win.addEventListener("resize", () => this.closeMenu());
    // Re-read storage when the panel regains focus (Quick run may have changed it).
    B.onFocus(async () => {
      this.refreshPanes();
      if (this.ui.view === "list") {
        this.state = await B.load();
        this.refreshResults();
      }
    });
  }

  async onClick(e) {
    const el = e.target.closest("[data-act]");
    if (!el || el.disabled) return;
    if (el.tagName === "BUTTON") e.preventDefault();
    const { act, id } = el.dataset;
    const s = id ? this.byId(id) : null;
    switch (act) {
      case "new":
        return this.openEditor(null);
      case "edit":
        // A double-click also fires two clicks; wait to see whether it becomes one.
        if (e.detail > 1) return;
        clearTimeout(this.clickTimer);
        this.clickTimer = setTimeout(() => s && this.openEditor(s), 220);
        return;
      case "back":
        return this.backToList();
      case "groups":
      case "io":
        this.ui.view = act;
        return this.render();
      case "collapse":
        if (this.ui.collapsed.has(id)) this.ui.collapsed.delete(id);
        else this.ui.collapsed.add(id);
        return this.refreshResults();
      case "run":
        return s && this.startRun(s, s.action === "insert" ? "run" : s.action);
      case "insert":
        return s && this.startRun(s, "insert");
      case "var-go":
        return this.send(this.byId(this.ui.run.id), this.ui.run.values, el.dataset.action);
      case "set-action":
        this.ui.draft.action = el.dataset.value;
        return this.updateSegmented(el);
      case "io-mode":
        this.ui.io.mode = el.dataset.value;
        return this.updateSegmented(el);
      case "save":
        return this.saveDraft();
      case "duplicate":
        return this.duplicate(this.ui.draft.id, true);
      case "delete":
        return this.deleteSnippet(this.byId(this.ui.draft.id));
      case "group-add": {
        await this.persist(C.addGroup(this.state, "New group").state);
        this.render();
        const inputs = this.root.querySelectorAll("[data-group-name]");
        const last = inputs[inputs.length - 1];
        if (last) (last.focus(), last.select());
        return;
      }
      case "group-up":
      case "group-down":
        await this.persist(C.moveGroup(this.state, id, act === "group-up" ? -1 : 1));
        return this.render();
      case "group-color":
        await this.persist(C.updateGroup(this.state, id, { color: el.dataset.color }));
        return this.render();
      case "group-del": {
        const g = this.state.groups.find((x) => x.id === id);
        const n = C.counts(this.state)[id] || 0;
        const message = n ? `${n} snippet(s) will move to Ungrouped.` : "The group is empty.";
        if (!(await B.confirm(`Delete group “${g.name}”?`, message, "Delete"))) return;
        await this.persist(C.deleteGroup(this.state, id, null));
        if (this.ui.group === id) this.ui.group = "all";
        return this.render();
      }
      case "copy-export": {
        const ta = this.$("io-export");
        try {
          await navigator.clipboard.writeText(ta.value);
        } catch {
          ta.select();
          this.root.ownerDocument.execCommand("copy");
        }
        return this.notify("ok", "Copied to clipboard");
      }
      case "import":
        return this.runImport();
    }
  }

  updateSegmented(active) {
    for (const btn of active.parentElement.children) {
      const on = btn === active;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-checked", String(on));
    }
  }

  async runImport() {
    const text = this.ui.io.text.trim();
    if (!text) return this.notify("error", "Paste JSON to import first.");
    try {
      if (this.ui.io.mode === "replace" && !(await B.confirm("Replace all snippets?", "Your current snippets and groups will be removed.", "Replace"))) {
        return;
      }
      const r = C.importJSON(text, this.state, this.ui.io.mode);
      await this.persist(r.state);
      this.ui.io.text = "";
      this.backToList();
      this.notify("ok", `Imported: ${r.added} added, ${r.updated} updated, ${r.groupsAdded} new group(s)`);
    } catch (err) {
      this.notify("error", `Import failed: ${err.message}`);
    }
  }

  onDblClick(e) {
    const body = e.target.closest(".sn-body");
    if (!body) return;
    e.preventDefault();
    clearTimeout(this.clickTimer);
    const s = this.byId(body.dataset.id);
    if (s) this.startRun(s, s.action);
  }

  onInput(e) {
    const t = e.target;
    const { draft, run } = this.ui;
    if (t.id === "q") {
      this.ui.q = t.value;
      return this.refreshResults();
    }
    if (t.dataset.draft && draft) {
      draft[t.dataset.draft] = t.value;
      if (t.dataset.draft === "command") {
        this.$("vars-detected").innerHTML = this.varsDetected(C.parseVars(t.value));
        this.$("secret-slot").innerHTML = this.secretHTML(C.looksSecret(t.value));
        this.$("cmd-error").textContent = "";
      }
      if (t.dataset.draft === "groupId") this.$("new-group-field").hidden = t.value !== "__new";
      return;
    }
    if (t.dataset.var && run) {
      run.values[t.dataset.var] = t.value;
      run.error = "";
      this.$("vars-error").textContent = "";
      this.$("vars-preview").textContent = C.fill(this.byId(run.id).command, run.values);
      return;
    }
    if (t.id === "io-import") this.ui.io.text = t.value;
    else if (t.id === "target") this.ui.target = t.value;
    else if (t.id === "group-filter") {
      this.ui.group = t.value;
      this.refreshResults();
    }
  }

  async onChange(e) {
    const t = e.target;
    if (t.dataset.groupName) {
      const name = t.value.trim();
      if (name) await this.persist(C.updateGroup(this.state, t.dataset.groupName, { name }));
      else t.value = this.state.groups.find((g) => g.id === t.dataset.groupName)?.name || "";
      return;
    }
    if (t.dataset.draft || t.id === "target" || t.id === "group-filter") this.onInput(e);
  }

  onKeyDown(e) {
    const t = e.target;
    const body = t.closest?.(".sn-body");
    // Keyboard equivalent of right-click on a focused row: Shift+F10 or the Menu key.
    if (body && (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) {
      e.preventDefault();
      const r = body.getBoundingClientRect();
      return this.openMenu(body.dataset.id, r.left + 16, r.bottom - 4);
    }
    if (this.menu) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    const { view } = this.ui;
    if (e.key === "/" && !typing && view === "list") {
      e.preventDefault();
      this.$("q").focus();
    } else if (e.key === "Escape" && view !== "list") {
      e.preventDefault();
      this.backToList();
    } else if (e.key === "Escape" && t.id === "q" && this.ui.q) {
      this.ui.q = "";
      t.value = "";
      this.refreshResults();
    } else if (e.key === "Enter" && t.id === "q") {
      const first = C.sections(this.state, this.ui.q, this.ui.group).flatMap((sec) => sec.items)[0];
      if (first) {
        e.preventDefault();
        this.startRun(first, e.altKey ? "insert" : first.action);
      }
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && view === "edit") {
      e.preventDefault();
      this.saveDraft();
    } else if (e.key === "Enter" && view === "vars" && t.dataset.var) {
      e.preventDefault();
      const action = e.altKey ? "insert" : e.metaKey || e.ctrlKey ? "tab" : this.ui.run.action;
      this.send(this.byId(this.ui.run.id), this.ui.run.values, action);
    }
  }
}
