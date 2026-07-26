import { clear, cls, h } from "@/lib/dom";
import icon from "@/lib/icons";
import { groupRecords, isAppPort, killPorts, openPort, requestPorts } from "@/lib/ports";

const APP_ONLY_KEY = "ports.appOnly";

export class PortsPanel {
  constructor(root, opts = {}) {
    this.root = root;
    this.projects = [];
    this.records = [];
    this.groups = [];
    this.loading = true;
    this.error = null;
    this.status = "";
    this.busyPids = new Set();
    this.appOnly = localStorage.getItem(APP_ONLY_KEY) !== "false";
  }

  async start() {
    muxy.events.subscribe("extension.ports.data", (payload) =>
      this.onData(payload?.records || []),
    );
    muxy.events.subscribe("extension.ports.killResult", (payload) =>
      this.onKillResult(payload || {}),
    );
    muxy.events.subscribe("command.refresh-ports", () => requestPorts());

    if (muxy.onFocus) {
      muxy.onFocus((focused) => focused && requestPorts());
    }

    try {
      this.projects = (await muxy.projects.list()) || [];
      this.render();

      await requestPorts();
    } catch (err) {
      this.error = err?.message || String(err);
      this.loading = false;
      this.render();
    }
  }

  onData(records) {
    this.records = records;
    this.rebuildGroups();
    this.loading = false;
    this.error = null;
    this.render();
  }

  onKillResult(payload) {
    const failed = payload.failed || [];
    const killed = payload.killed || [];

    this.busyPids.clear();
    if (failed.length > 0) {
      this.status = `Failed to stop ${failed.length} port${failed.length === 1 ? "" : "s"}.`;
    } else if (killed.length > 0) {
      this.status = `Stopped ${killed.length} port${killed.length === 1 ? "" : "s"}.`;
    } else {
      this.status = "No matching ports to stop.";
    }
    this.render();
  }

  rebuildGroups() {
    this.groups = groupRecords(this.visibleRecords(), this.projects);
  }

  visibleRecords() {
    if (!this.appOnly) return this.records;
    return this.records.filter((rec) => isAppPort(rec, this.projects));
  }

  get total() {
    return this.groups.reduce((n, g) => n + g.ports.length, 0);
  }

  get busy() {
    return this.busyPids.size > 0;
  }

  render() {
    clear(this.root);
    this.root.appendChild(this.view());
  }

  view() {
    return h(
      "div",
      {
        class: "flex h-full flex-col",
      },
      this.header(),
      h(
        "div",
        {
          class: "min-h-0 flex-1 overflow-y-auto",
        },
        this.body(),
      ),
    );
  }

  header() {
    const visible = this.total;
    const all = this.records.length;

    return h(
      "div",
      {
        class:
          "flex items-center gap-1.5 border-b border-border px-2.5 py-2 text-[11px] font-semibold uppercase text-muted-foreground",
      },
      icon("radio", 13, "text-primary"),
      h("span", null, "Ports"),
      this.toggleAppOnly(),
      h(
        "button",
        {
          type: "button",
          title: "Stop all visible ports",
          disabled: visible === 0 || this.busy,
          class: cls(
            "ml-auto inline-flex h-6 items-center gap-1 rounded-md border border-border bg-surface px-2 text-[11px] normal-case text-muted-foreground outline-none transition-colors hover:border-[color:var(--muxy-diff-remove)] hover:text-[color:var(--muxy-diff-remove)] disabled:opacity-40",
          ),
          onclick: () => this.stopVisible(),
        },
        icon("trash", 12),
        "Stop all",
      ),
      h(
        "span",
        { class: "min-w-[42px] text-right font-mono text-[11px] text-muted-foreground" },
        this.appOnly ? `${visible}/${all}` : String(visible),
      ),
    );
  }

  toggleAppOnly() {
    return h(
      "button",
      {
        type: "button",
        title: "Show only ports from Muxy projects",
        class: cls(
          "inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] normal-case outline-none transition-colors",
          this.appOnly
            ? "border-primary bg-accent text-foreground"
            : "border-border bg-surface text-muted-foreground hover:bg-accent",
        ),
        onclick: () => this.setAppOnly(!this.appOnly),
      },
      icon("filter", 12),
      "App only",
    );
  }

  body() {
    if (this.loading) return this.message("Scanning ports...");
    if (this.error) return this.message(this.error, true);

    if (this.groups.length === 0) {
      const text = this.appOnly
        ? "No ports from Muxy projects found."
        : "No listening ports found.";
      return h(
        "div",
        { class: "flex flex-col gap-3 p-2.5" },
        this.status ? this.statusLine() : null,
        this.message(text),
      );
    }

    return h(
      "div",
      { class: "flex flex-col gap-3 p-2.5" },
      this.status ? this.statusLine() : null,
      this.groups.map((g) => this.group(g)),
    );
  }

  statusLine() {
    return h(
      "div",
      {
        class:
          "rounded-md border border-border bg-surface px-2.5 py-1.5 text-[11px] text-muted-foreground",
      },
      this.status,
    );
  }

  group(group) {
    const busy = group.ports.some((port) => this.busyPids.has(port.pid));

    return h(
      "div",
      { class: "flex flex-col gap-1.5" },
      h(
        "div",
        {
          class:
            "flex items-center gap-1.5 px-0.5 text-[11px] font-medium text-muted-foreground",
        },
        icon("folder", 11, "shrink-0 opacity-70"),
        h("span", { class: "truncate" }, group.name),
        h("span", { class: "ml-auto font-mono opacity-70" }, String(group.ports.length)),
        h(
          "button",
          {
            type: "button",
            title: `Stop all ports in ${group.name}`,
            disabled: busy || this.busy,
            class:
              "inline-flex h-5 w-5 items-center justify-center rounded border border-border bg-surface text-muted-foreground outline-none transition-colors hover:border-[color:var(--muxy-diff-remove)] hover:text-[color:var(--muxy-diff-remove)] disabled:opacity-40",
            onclick: () => this.stopGroup(group),
          },
          icon("trash", 11),
        ),
      ),
      h(
        "div",
        { class: "grid grid-cols-2 gap-1.5" },
        group.ports.map((p) => this.chip(p)),
      ),
    );
  }

  chip(p) {
    const busy = this.busyPids.has(p.pid);
    const title = p.command ? `${p.command} · pid ${p.pid}\n${p.cwd || ""}` : "";

    return h(
      "div",
      {
        title: title.trim(),
        class:
          "flex min-w-0 items-stretch overflow-hidden rounded-md border border-border bg-surface text-left transition-colors hover:border-primary",
      },
      h(
        "button",
        {
          type: "button",
          class:
            "flex min-w-0 flex-1 items-center justify-between gap-1.5 px-2.5 py-1.5 text-left outline-none hover:bg-accent",
          onclick: () => this.open(p.port),
        },
        h("span", { class: "font-mono text-[12px] font-semibold text-foreground" }, String(p.port)),
        h("span", { class: "truncate text-[10px] text-muted-foreground" }, p.command || ""),
      ),
      h(
        "button",
        {
          type: "button",
          title: `Stop port ${p.port}`,
          disabled: busy,
          class:
            "flex w-7 shrink-0 items-center justify-center border-l border-border text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-[color:var(--muxy-diff-remove)] disabled:opacity-40",
          onclick: () => this.stopOne(p),
        },
        icon("trash", 12),
      ),
    );
  }

  setAppOnly(value) {
    this.appOnly = value;
    localStorage.setItem(APP_ONLY_KEY, value ? "true" : "false");
    this.status = "";
    this.rebuildGroups();
    this.render();
  }

  open(port) {
    openPort(port).catch(() => {});
  }

  stopOne(record) {
    this.stopRecords([record], `Stopping port ${record.port}...`);
  }

  stopVisible() {
    const records = this.visibleRecords();
    if (records.length === 0) return;
    this.stopRecords(
      records,
      `Stopping ${records.length} visible port${records.length === 1 ? "" : "s"}...`,
    );
  }

  stopGroup(group) {
    const records = group.ports;
    if (records.length === 0) return;
    this.stopRecords(
      records,
      `Stopping ${records.length} port${records.length === 1 ? "" : "s"} in ${group.name}...`,
    );
  }

  stopRecords(records, message) {
    const pids = new Set(records.map((rec) => rec.pid));

    this.status = message;
    for (const pid of pids) this.busyPids.add(pid);
    this.render();

    killPorts(records).catch((err) => {
      for (const pid of pids) this.busyPids.delete(pid);
      this.status = err?.message || String(err);
      this.render();
    });
  }

  message(text, isError = false) {
    return h(
      "div",
      {
        class: cls(
          "flex h-full items-center justify-center px-4 py-8 text-center text-[12px]",
          isError ? "text-[color:var(--muxy-diff-remove)]" : "text-muted-foreground",
        ),
      },
      text,
    );
  }
}
