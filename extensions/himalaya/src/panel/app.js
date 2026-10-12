import { escapeHtml } from "@muxy/ui";
import { clear, h } from "@/lib/dom";
import makeIcon from "@/lib/icons";
import { formatDate, formatFrom, hasFlag } from "@/lib/format";
import {
  createClient,
  HimalayaMissingError,
  resetBinary,
} from "@/lib/himalaya";
import { parseMessage } from "@/lib/mime";
import { htmlToText } from "@/lib/htmltext";

const LS_ACCOUNT = "himalaya.account";
const LS_MAILBOX = "himalaya.mailbox";

async function getSetting(key, fallback) {
  try {
    if (muxy.settings?.get) {
      const value = await muxy.settings.get(key);
      if (value !== null && value !== undefined && value !== "") return value;
    }
  } catch {
    // fall through to default
  }
  return fallback;
}

export class MailPanel {
  constructor(root) {
    this.root = root;

    this.binary = "";
    this.pageSize = 25;

    this.accounts = [];
    this.account = localStorage.getItem(LS_ACCOUNT) || "";
    this.mailboxes = [];
    this.mailbox = localStorage.getItem(LS_MAILBOX) || "";

    this.envelopes = [];
    this.page = 1;

    this.view = "list"; // "list" | "message"
    this.message = null; // { envelope, body, loading, error }
    this.flash = null; // transient status shown in the message action bar
    this.busy = false; // an action is running

    this.loading = true;
    this.error = null;
    this.notConfigured = false;
    this.missing = false;
  }

  client() {
    return createClient({ binary: this.binary, account: this.account });
  }

  async start() {
    muxy.events.subscribe("command.refresh-mail", () => this.refresh());
    if (muxy.onFocus) {
      muxy.onFocus((focused) => {
        if (focused && this.view === "list") this.loadEnvelopes();
      });
    }

    this.binary = await getSetting("binary", "");
    this.pageSize = Number(await getSetting("pageSize", 25)) || 25;
    const settingAccount = await getSetting("account", "");
    if (settingAccount) this.account = settingAccount;

    this.render();
    await this.loadAccounts();
  }

  // --- data loading -------------------------------------------------------

  async loadAccounts() {
    this.loading = true;
    this.error = null;
    this.notConfigured = false;
    this.missing = false;
    this.render();

    try {
      this.accounts = await this.client().accounts();
      if (this.accounts.length === 0) {
        this.notConfigured = true;
        this.loading = false;
        this.render();
        return;
      }
      // Pick the stored/settings account if it still exists, else the default.
      const names = this.accounts.map((a) => a.name);
      if (!this.account || !names.includes(this.account)) {
        const def = this.accounts.find((a) => a.default) || this.accounts[0];
        this.account = def.name;
      }
      await this.loadMailboxes();
    } catch (err) {
      this.loading = false;
      if (err instanceof HimalayaMissingError) this.missing = true;
      else this.error = err?.message || String(err);
      this.render();
    }
  }

  async loadMailboxes() {
    try {
      this.mailboxes = await this.client().mailboxes();
      const names = this.mailboxes.map((m) => m.name);
      if (!this.mailbox || !names.includes(this.mailbox)) {
        const inbox = this.mailboxes.find((m) => /inbox/i.test(m.name));
        this.mailbox = inbox ? inbox.name : this.mailboxes[0]?.name || "";
      }
    } catch (err) {
      // Some backends have no mailbox listing; fall back to the inbox default.
      this.mailboxes = [];
      if (!this.mailbox) this.mailbox = "";
    }
    this.page = 1;
    await this.loadEnvelopes();
  }

  async loadEnvelopes() {
    this.loading = true;
    this.error = null;
    this.render();
    try {
      this.envelopes = await this.client().envelopes({
        mailbox: this.mailbox || undefined,
        page: this.page,
        pageSize: this.pageSize,
      });
      this.loading = false;
      this.render();
    } catch (err) {
      this.loading = false;
      if (err instanceof HimalayaMissingError) this.missing = true;
      else this.error = err?.message || String(err);
      this.render();
    }
  }

  async openMessage(envelope) {
    this.view = "message";
    this.message = {
      envelope,
      body: "",
      loading: true,
      error: null,
      mode: "text", // "text" | "html" | "reader"
      parsed: null, // { text, html } from the raw message, loaded lazily
      rawLoading: false,
      rawError: null,
    };
    this.render();
    try {
      const body = await this.client().readMessage({
        id: envelope.id,
        mailbox: this.mailbox || undefined,
      });
      this.message.body = body;
      // Reading marks the message seen on the backend; reflect that locally.
      if (!hasFlag(envelope, "Seen")) envelope.flags = [...(envelope.flags || []), { raw: "\\Seen", iana: "Seen" }];
    } catch (err) {
      this.message.error = err?.message || String(err);
    }
    if (this.message) this.message.loading = false;
    this.render();
  }

  backToList() {
    this.view = "list";
    this.message = null;
    this.flash = null;
    this.render();
  }

  // --- context menu (copy Himalaya references for AI prompts) -------------

  // Build the account/mailbox flags an AI (or you) would pass to himalaya.
  refFlags() {
    const flags = [];
    if (this.account) flags.push("-a", this.account);
    if (this.mailbox) flags.push("-m", this.mailbox);
    return flags.join(" ");
  }

  async copyText(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      this.toast(label);
    } catch {
      this.toast("Copy failed");
    }
  }

  // A small self-dismissing toast (no permission needed, works from any view).
  toast(text) {
    const el = h("div", { class: "mail-toast" }, text);
    document.body.append(el);
    requestAnimationFrame(() => el.classList.add("is-on"));
    setTimeout(() => {
      el.classList.remove("is-on");
      setTimeout(() => el.remove(), 200);
    }, 1400);
  }

  closeMenu() {
    if (this._menu) {
      this._menu.remove();
      this._menu = null;
    }
    if (this._menuDismiss) {
      document.removeEventListener("pointerdown", this._menuDismiss, true);
      document.removeEventListener("keydown", this._menuKey, true);
      this._menuDismiss = null;
    }
  }

  // Render a floating menu at (x, y). Each item is { label, run }.
  showMenu(items, x, y) {
    this.closeMenu();
    const menu = h("div", { class: "mx-menu mail-menu" });
    for (const item of items) {
      menu.append(
        h(
          "button",
          {
            class: "mx-menu-item",
            onClick: () => {
              this.closeMenu();
              item.run();
            },
          },
          item.label,
        ),
      );
    }

    document.body.append(menu);
    // Keep the menu inside the viewport.
    const rect = menu.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 8);
    const top = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;

    this._menu = menu;
    this._menuDismiss = (ev) => {
      if (!menu.contains(ev.target)) this.closeMenu();
    };
    this._menuKey = (ev) => {
      if (ev.key === "Escape") this.closeMenu();
    };
    document.addEventListener("pointerdown", this._menuDismiss, true);
    document.addEventListener("keydown", this._menuKey, true);
  }

  // Right-click a list row: copy Himalaya references for AI prompts.
  openRowMenu(env, x, y) {
    const flags = this.refFlags();
    const ref = (verb) => `himalaya message ${verb} ${flags} ${env.id}`.replace(/\s+/g, " ").trim();
    this.showMenu(
      [
        { label: "Copy message ID", run: () => this.copyText(String(env.id), "Copied ID") },
        { label: "Copy reply command", run: () => this.copyText(ref("reply"), "Copied reply command") },
        { label: "Copy read command", run: () => this.copyText(ref("read"), "Copied read command") },
      ],
      x,
      y,
    );
  }

  // Right-click the Copy button: choose which form of the content to copy.
  openCopyMenu(x, y) {
    const m = this.message;
    if (!m) return;
    this.showMenu(
      [
        { label: "Copy text", run: () => this.copyText(m.body || "", "Copied text") },
        {
          label: "Copy stripped text (reader)",
          run: async () => {
            const parsed = await this.ensureRaw();
            const text = parsed?.html ? htmlToText(parsed.html) : m.body || "";
            this.copyText(text, "Copied reader text");
          },
        },
        {
          label: "Copy HTML source",
          run: async () => {
            const parsed = await this.ensureRaw();
            if (parsed?.html) this.copyText(parsed.html, "Copied HTML");
            else this.toast("No HTML part");
          },
        },
      ],
      x,
      y,
    );
  }

  // --- message actions ----------------------------------------------------

  flashStatus(text) {
    this.flash = text;
    this.render();
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => {
      this.flash = null;
      if (this.view === "message") this.render();
    }, 1600);
  }

  // Copy the content in whatever form is currently shown: plain text, the
  // stripped reader text, or the HTML source. Right-click the button to choose.
  copyContent() {
    const m = this.message;
    if (!m) return;
    if (m.mode === "reader" && m.parsed?.html) this.copyText(htmlToText(m.parsed.html), "Copied reader text");
    else if (m.mode === "html" && m.parsed?.html) this.copyText(m.parsed.html, "Copied HTML");
    else this.copyText(m.body || "", "Copied text");
  }

  // Load and parse the raw message once; returns { text, html } (or null).
  async ensureRaw() {
    const m = this.message;
    if (!m) return null;
    if (m.parsed) return m.parsed;
    if (!m.rawLoading) {
      m.rawLoading = true;
      this.render();
      try {
        const raw = await this.client().readRaw({
          id: m.envelope.id,
          mailbox: this.mailbox || undefined,
        });
        if (this.message === m) m.parsed = parseMessage(raw);
      } catch (err) {
        if (this.message === m) m.rawError = err?.message || String(err);
      }
      if (this.message === m) m.rawLoading = false;
      this.render();
    }
    return m.parsed;
  }

  async setMode(mode) {
    if (!this.message) return;
    this.message.mode = mode;
    // HTML and Reader need the raw message parsed; load it once, lazily.
    if (mode === "html" || mode === "reader") await this.ensureRaw();
    this.render();
  }

  // Remove the current message from the list after it moved out of the mailbox.
  dropCurrentEnvelope() {
    const id = this.message?.envelope?.id;
    if (id != null) this.envelopes = this.envelopes.filter((e) => e.id !== id);
  }

  async runAction(fn, { leave = false } = {}) {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      await fn();
      if (leave) {
        this.dropCurrentEnvelope();
        this.busy = false;
        this.backToList();
        this.loadEnvelopes();
      } else {
        this.busy = false;
        this.render();
      }
    } catch (err) {
      this.busy = false;
      const msg = err?.message || String(err);
      if (muxy.dialog?.alert) await muxy.dialog.alert({ title: "Action failed", message: msg });
      else this.flashStatus("Failed");
      this.render();
    }
  }

  async archiveMessage() {
    const env = this.message?.envelope;
    if (!env) return;
    const archive = this.mailboxes.find((m) => /archive/i.test(m.name));
    if (!archive) {
      this.moveMessage();
      return;
    }
    await this.runAction(
      () => this.client().move({ ids: [env.id], from: this.mailbox || undefined, to: archive.name }),
      { leave: true },
    );
  }

  async moveMessage() {
    const env = this.message?.envelope;
    if (!env) return;
    const items = this.mailboxes
      .filter((m) => m.name !== this.mailbox)
      .map((m) => ({ id: m.name, title: m.name, subtitle: m.unread ? `${m.unread} unread` : "" }));
    if (items.length === 0) {
      this.flashStatus("No other mailboxes");
      return;
    }
    const picked = await muxy.modal.open({ items, placeholder: "Move to mailbox…" });
    if (!picked) return;
    await this.runAction(
      () => this.client().move({ ids: [env.id], from: this.mailbox || undefined, to: picked.id }),
      { leave: true },
    );
  }

  async markUnread() {
    const env = this.message?.envelope;
    if (!env) return;
    await this.runAction(
      () => this.client().setFlag({ ids: [env.id], mailbox: this.mailbox || undefined, flag: "Seen", on: false }),
      { leave: true },
    );
  }

  async deleteMessage() {
    const env = this.message?.envelope;
    if (!env) return;
    const choice = await muxy.dialog.confirm({
      title: "Delete message",
      message: `Delete "${env.subject || "(no subject)"}"? On IMAP it moves to Trash.`,
      buttons: ["Delete", "Cancel"],
      cancel: "Cancel",
      style: "warning",
    });
    if (choice !== "Delete") return;
    await this.runAction(
      () => this.client().remove({ ids: [env.id], mailbox: this.mailbox || undefined }),
      { leave: true },
    );
  }

  refresh() {
    resetBinary();
    if (this.view === "message" && this.message) this.openMessage(this.message.envelope);
    else if (this.missing || this.notConfigured || this.accounts.length === 0) this.loadAccounts();
    else this.loadEnvelopes();
  }

  onAccountChange(name) {
    this.account = name;
    localStorage.setItem(LS_ACCOUNT, name);
    this.mailbox = "";
    this.loadMailboxes();
  }

  onMailboxChange(name) {
    this.mailbox = name;
    localStorage.setItem(LS_MAILBOX, name);
    this.page = 1;
    this.loadEnvelopes();
  }

  changePage(delta) {
    const next = this.page + delta;
    if (next < 1) return;
    this.page = next;
    this.loadEnvelopes();
  }

  // --- rendering ----------------------------------------------------------

  render() {
    const root = clear(this.root);
    if (this.view === "message") {
      root.append(this.renderMessage());
      return;
    }
    root.append(this.renderToolbar());
    root.append(this.renderBody());
  }

  renderToolbar() {
    const bar = h("div", { class: "mail-toolbar" });

    if (this.accounts.length > 0) {
      const accSelect = h("select", {
        class: "mx-select mail-account",
        title: "Account",
        onChange: (e) => this.onAccountChange(e.target.value),
      });
      for (const a of this.accounts) {
        accSelect.append(
          h("option", { value: a.name, selected: a.name === this.account }, a.name),
        );
      }
      bar.append(accSelect);
    }

    if (this.mailboxes.length > 0) {
      const mbSelect = h("select", {
        class: "mx-select mail-mailbox",
        title: "Mailbox",
        onChange: (e) => this.onMailboxChange(e.target.value),
      });
      for (const m of this.mailboxes) {
        const count = m.unread ? ` (${m.unread})` : "";
        mbSelect.append(
          h("option", { value: m.name, selected: m.name === this.mailbox }, `${m.name}${count}`),
        );
      }
      bar.append(mbSelect);
    }

    return bar;
  }

  renderBody() {
    if (this.missing) return this.renderMissing();
    if (this.notConfigured) return this.renderNotConfigured();
    if (this.error) return this.renderError();
    if (this.loading && this.envelopes.length === 0) return this.renderLoading();
    if (this.envelopes.length === 0) return this.renderEmpty();
    return this.renderList();
  }

  renderList() {
    const wrap = h("div", { class: "mail-scroll" });
    const list = h("div", { class: "mx-list" });
    for (const env of this.envelopes) {
      list.append(this.renderRow(env));
    }
    wrap.append(list);
    wrap.append(this.renderPager());
    return wrap;
  }

  renderRow(env) {
    const unread = !hasFlag(env, "Seen");
    const row = h("div", {
      class: `mx-row mail-row${unread ? " is-unread" : ""}`,
      role: "button",
      tabindex: "0",
      onClick: () => this.openMessage(env),
      onKeydown: (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          this.openMessage(env);
        }
      },
      onContextmenu: (e) => {
        e.preventDefault();
        this.openRowMenu(env, e.clientX, e.clientY);
      },
    });

    const dot = h("span", { class: `mail-dot${unread ? " is-on" : ""}` });

    const main = h("div", { class: "mail-row-main" });
    const top = h("div", { class: "mail-row-top" });
    top.append(h("span", { class: "mail-from" }, formatFrom(env.from)));
    top.append(h("span", { class: "mail-date" }, formatDate(env.date)));
    main.append(top);

    const sub = h("div", { class: "mail-row-sub" });
    if (env["has-attachment"]) {
      const clip = makeIcon("paperclip", { size: 12, className: "mail-clip" });
      sub.append(clip);
    }
    sub.append(h("span", { class: "mail-subject" }, env.subject || "(no subject)"));
    main.append(sub);

    row.append(dot, main);
    return row;
  }

  renderPager() {
    const pager = h("div", { class: "mail-pager" });
    const prev = h("button", {
      class: "mx-icon-btn",
      title: "Previous page",
      disabled: this.page <= 1 || this.loading,
      onClick: () => this.changePage(-1),
    });
    prev.append(makeIcon("chevronLeft", { size: 14 }));

    const label = h("span", { class: "mail-page-label" }, `Page ${this.page}`);

    const hasMore = this.envelopes.length >= this.pageSize;
    const next = h("button", {
      class: "mx-icon-btn",
      title: "Next page",
      disabled: !hasMore || this.loading,
      onClick: () => this.changePage(1),
    });
    next.append(makeIcon("chevronRight", { size: 14 }));

    pager.append(prev, label, next);
    return pager;
  }

  renderMessage() {
    const wrap = h("div", { class: "mail-message" });

    const header = h("div", { class: "mail-msg-header" });
    const back = h("button", { class: "mx-icon-btn", title: "Back", onClick: () => this.backToList() });
    back.append(makeIcon("chevronLeft", { size: 16 }));
    header.append(back);
    const env = this.message?.envelope;
    header.append(
      h("div", { class: "mail-msg-title" }, env?.subject || "(no subject)"),
    );
    wrap.append(header);

    if (env) {
      const meta = h("div", { class: "mail-msg-meta" });
      meta.append(h("div", { class: "mail-msg-from" }, formatFrom(env.from)));
      meta.append(h("div", { class: "mail-msg-date" }, formatDate(env.date)));
      wrap.append(meta);
    }

    wrap.append(this.renderActions());
    if (!this.message?.loading && !this.message?.error) wrap.append(this.renderViewSwitch());
    wrap.append(this.renderMessageBody());
    return wrap;
  }

  renderViewSwitch() {
    const seg = h("div", { class: "mx-segmented mail-view-switch" });
    const opt = (mode, label) => {
      const b = h(
        "button",
        {
          class: `mx-segmented-btn${this.message.mode === mode ? " is-active" : ""}`,
          onClick: () => this.setMode(mode),
        },
        label,
      );
      return b;
    };
    seg.append(opt("text", "Text"), opt("html", "HTML"), opt("reader", "Reader"));
    return seg;
  }

  renderMessageBody() {
    const body = h("div", { class: "mail-msg-body" });
    const msg = this.message;
    if (msg?.loading) {
      body.append(this.spinner("Loading message…"));
      return body;
    }
    if (msg?.error) {
      body.append(this.empty("alert", "Could not open message", msg.error));
      return body;
    }

    if (msg.mode === "text") {
      body.append(h("pre", { class: "mail-msg-text" }, msg.body || ""));
      return body;
    }

    // HTML / Reader both need the parsed raw message.
    if (msg.rawLoading) {
      body.append(this.spinner("Loading full message…"));
      return body;
    }
    if (msg.rawError) {
      body.append(this.empty("alert", "Could not load HTML", msg.rawError));
      return body;
    }
    const html = msg.parsed?.html;
    if (!html) {
      body.append(this.empty("mail", "No HTML part", "This message has no HTML body — showing text instead."));
      body.append(h("pre", { class: "mail-msg-text" }, msg.body || ""));
      return body;
    }

    if (msg.mode === "reader") {
      body.append(h("pre", { class: "mail-msg-text" }, htmlToText(html)));
      return body;
    }

    // Rendered HTML, sandboxed: no scripts, no plugins, no top navigation.
    // Remote images can load (that is the point of opting in for a trusted
    // sender), but active content is blocked by both the sandbox and a CSP.
    body.classList.add("is-html");
    const note = h("div", { class: "mail-html-note" }, "Rendered HTML — scripts blocked; remote images may load.");
    const frame = h("iframe", {
      class: "mail-html-frame",
      sandbox: "",
      referrerpolicy: "no-referrer",
      srcdoc: `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><base target="_blank"><style>html,body{margin:0}body{padding:12px;font-family:-apple-system,'Segoe UI',sans-serif;color:#111;background:#fff;word-break:break-word}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`,
    });
    body.append(note, frame);
    return body;
  }

  renderActions() {
    const bar = h("div", { class: "mail-actions" });
    const ready = !this.message?.loading && !this.message?.error;

    const btn = (iconName, tooltip, handler, { primary = false, onContext = null } = {}) => {
      const attrs = {
        class: `mx-icon-btn${primary ? " mail-action-copy" : ""}`,
        title: tooltip,
        "aria-label": tooltip,
        disabled: this.busy || !ready,
        onClick: handler,
      };
      if (onContext) {
        attrs.onContextmenu = (e) => {
          e.preventDefault();
          onContext(e);
        };
      }
      const b = h("button", attrs);
      b.append(makeIcon(iconName, { size: 15 }));
      return b;
    };

    bar.append(
      btn("copy", "Copy content (right-click for options)", () => this.copyContent(), {
        primary: true,
        onContext: (e) => this.openCopyMenu(e.clientX, e.clientY),
      }),
    );
    bar.append(btn("mailOpen", "Mark as unread", () => this.markUnread()));
    bar.append(btn("archive", "Archive", () => this.archiveMessage()));
    bar.append(btn("folder", "Move to…", () => this.moveMessage()));
    bar.append(h("span", { class: "mx-spacer", style: "flex:1 1 auto" }));
    bar.append(btn("trash", "Delete", () => this.deleteMessage()));

    if (this.flash) {
      bar.append(h("span", { class: "mail-flash" }, [makeIcon("check", { size: 13 }), this.flash]));
    }
    return bar;
  }

  // --- states -------------------------------------------------------------

  renderLoading() {
    return this.spinner("Loading mailbox…");
  }

  renderEmpty() {
    return this.empty("inbox", "No messages", "This mailbox is empty.");
  }

  renderError() {
    const el = this.empty("alert", "Something went wrong", this.error);
    el.append(this.retryButton());
    return el;
  }

  renderMissing() {
    const el = this.empty(
      "alert",
      "Himalaya not found",
      "Install the Himalaya CLI, then reload. If it is installed in a custom location, set its full path in the extension settings.",
    );
    const hint = h("code", { class: "mail-hint" }, "brew install himalaya");
    el.append(hint);
    el.append(this.retryButton());
    return el;
  }

  renderNotConfigured() {
    const el = this.empty(
      "mail",
      "No account configured",
      "Run Himalaya's setup wizard in a terminal to add an account, then reload.",
    );
    const hint = h("code", { class: "mail-hint" }, "himalaya configure");
    el.append(hint);
    el.append(this.retryButton());
    return el;
  }

  retryButton() {
    const btn = h("button", { class: "mx-btn", onClick: () => this.refresh() }, "Retry");
    return h("div", { class: "mail-retry" }, [btn]);
  }

  spinner(text) {
    const wrap = h("div", { class: "mail-center" });
    wrap.append(h("div", { class: "mx-spinner" }));
    wrap.append(h("div", { class: "mail-center-text" }, text));
    return wrap;
  }

  empty(iconName, title, copy) {
    const wrap = h("div", { class: "mx-empty mail-empty" });
    wrap.append(h("div", { class: "mail-empty-icon" }, [makeIcon(iconName, { size: 28 })]));
    wrap.append(h("div", { class: "mx-empty-title" }, title));
    if (copy) wrap.append(h("div", { class: "mx-empty-copy", html: escapeHtml(copy) }));
    return wrap;
  }
}
