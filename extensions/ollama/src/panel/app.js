import { clear, cls, h } from "@/lib/dom";
import icon, { brandIcon } from "@/lib/icons";
import { OllamaStore } from "@/lib/store";
import {
  POLL_MS,
  buildLaunchCommand,
  errMessage,
  filterModels,
  hostLabel,
  modelSubtitle,
  shellQuote,
} from "@/lib/ollama";

export class OllamaPanel {
  constructor(root) {
    this.root = root;
    this.store = new OllamaStore();
    this.loading = true;
    this.error = null;
    this.status = "";
    this.launching = false;
    this.modelQuery = "";
    this.modelListNode = null;
    this.timer = null;
  }

  async start() {
    muxy.events.subscribe("extension.ollama.refresh", () => this.refresh());
    muxy.events.subscribe("extension.ollama.addServer", () => this.promptAddServer());
    if (muxy.onFocus) muxy.onFocus((focused) => focused && this.poll());

    try {
      await this.store.load();
    } catch (err) {
      this.error = errMessage(err);
      this.loading = false;
      this.render();
      return;
    }

    this.render();
    await this.refresh();
    this.timer = setInterval(() => this.poll(), POLL_MS);
  }

  get selectedServer() {
    return this.store.server(this.store.defaults.serverId) || this.store.servers[0] || null;
  }

  get visibleModels() {
    const server = this.selectedServer;
    if (!server) return [];
    return filterModels(this.store.modelsOf(server.id).items, this.modelQuery);
  }

  async refresh() {
    await Promise.all([this.store.refreshAgents(), this.store.pollAll()]);
    await this.reconcileSelection();
    this.loading = false;
    this.render();
    this.publishStatus();
  }

  async poll() {
    await this.store.pollAll();
    await this.reconcileSelection();
    this.render();
    this.publishStatus();
  }

  async reconcileSelection() {
    const store = this.store;
    const server = this.selectedServer;

    if (!store.defaults.agent && store.agents.length > 0) {
      const preferred = store.agents.find((agent) => agent.name === "claude");
      await store.setDefaults({ agent: (preferred || store.agents[0]).name });
    }

    if (server) {
      const items = store.modelsOf(server.id).items;
      if (items.length > 0) {
        const current = store.serverModel(server.id);
        if (!current || !items.some((m) => m.name === current)) {
          await store.setServerModel(server.id, items[0].name);
        }
      }
    }
  }

  publishStatus() {
    const server = this.selectedServer;
    const model = this.store.selectedModel();
    const { extraArgs } = this.store.defaults;
    const suffixParts = [];
    if (model) suffixParts.push(` --model ${shellQuote(model)}`);
    const extra = String(extraArgs || "").trim();
    if (extra) suffixParts.push(` -- ${extra}`);

    muxy.events
      .emit("extension.ollama.status", {
        online: this.store.onlineCount(),
        total: this.store.servers.length,
        serverName: server ? server.name : "",
        model: model || "",
        agents: this.store.agents,
        commandPrefix: server ? `OLLAMA_HOST=${shellQuote(server.url)} ollama launch` : "",
        commandSuffix: suffixParts.join(""),
      })
      .catch(() => {});
  }

  async promptAddServer() {
    const url = await muxy.dialog.prompt({
      title: "Add Ollama server",
      message: "Base URL of the Ollama server",
      placeholder: "http://192.168.1.49:11434",
      default: "http://",
    });
    if (url === null || url === undefined) return;

    const name = await muxy.dialog.prompt({
      title: "Name this server",
      message: String(url),
      default: hostLabel(url),
    });
    if (name === null || name === undefined) return;

    const result = await this.store.addServer(url, name);
    this.status = result.ok ? `Added ${result.server.name}.` : result.error;
    await this.reconcileSelection();
    this.render();
    this.publishStatus();
  }

  async promptRename(server) {
    const name = await muxy.dialog.prompt({
      title: "Rename server",
      message: server.url,
      default: server.name,
    });
    if (name === null || name === undefined) return;
    await this.store.renameServer(server.id, name);
    this.render();
    this.publishStatus();
  }

  async confirmRemove(server) {
    const confirmed = await muxy.dialog.confirm({
      title: `Remove ${server.name}?`,
      message: `${server.url} will be removed from the list.`,
      style: "warning",
      default: "Remove",
      cancel: "Cancel",
    });
    if (!confirmed) return;

    await this.store.removeServer(server.id);
    this.status = `Removed ${server.name}.`;
    await this.reconcileSelection();
    this.render();
    this.publishStatus();
  }

  async selectServer(id) {
    await this.store.setDefaults({ serverId: id });
    this.modelQuery = "";
    await this.reconcileSelection();
    this.render();
    this.publishStatus();
  }

  async selectModel(name) {
    if (this.store.defaults.serverId) await this.store.setServerModel(this.store.defaults.serverId, name);
    this.render();
    this.publishStatus();
  }

  async selectAgent(name) {
    await this.store.setDefaults({ agent: name });
    this.publishStatus();
  }

  async setExtraArgs(value) {
    await this.store.setDefaults({ extraArgs: value });
    this.publishStatus();
  }

  async launch() {
    const server = this.selectedServer;
    const { agent, extraArgs } = this.store.defaults;
    const model = this.store.selectedModel();
    if (!server || !agent) return;

    const command = buildLaunchCommand({ url: server.url, agent, model, extraArgs });
    this.launching = true;
    this.status = `Launching ${agent}...`;
    this.render();

    try {
      await muxy.tabs.open({ kind: "terminal", command });
      this.status = `Launched ${agent} on ${server.name}${model ? ` with ${model}` : ""}.`;
    } catch (err) {
      this.status = errMessage(err);
    } finally {
      this.launching = false;
      this.render();
    }
  }

  render() {
    const active = this.root.querySelector('[data-focus="model-search"]');
    const hadFocus = !!(active && active === document.activeElement);
    let selStart = null;
    let selEnd = null;
    if (hadFocus) {
      selStart = active.selectionStart;
      selEnd = active.selectionEnd;
    }
    clear(this.root);
    this.root.appendChild(this.view());
    if (hadFocus) {
      const node = this.root.querySelector('[data-focus="model-search"]');
      if (node) {
        node.focus();
        if (selStart != null && selEnd != null) node.setSelectionRange(selStart, selEnd);
      }
    }
  }

  view() {
    return h(
      "div",
      { class: "flex h-full flex-col" },
      this.header(),
      h("div", { class: "min-h-0 flex-1 overflow-y-auto" }, this.body()),
    );
  }

  header() {
    const online = this.store.onlineCount();
    const total = this.store.servers.length;

    return h(
      "div",
      {
        class:
          "flex items-center gap-1.5 border-b border-border px-2.5 py-2 text-[11px] font-semibold uppercase text-muted-foreground",
      },
      brandIcon(14, "text-primary"),
      h("span", null, "Ollama"),
      h(
        "button",
        {
          type: "button",
          title: "Add server",
          class:
            "ml-auto inline-flex h-6 items-center gap-1 rounded-md border border-border bg-surface px-2 text-[11px] normal-case text-muted-foreground outline-none transition-colors hover:border-primary hover:text-foreground",
          onclick: () => this.promptAddServer(),
        },
        icon("plus", 12),
        "Add",
      ),
      h(
        "span",
        { class: "min-w-[34px] text-right font-mono text-[11px] text-muted-foreground" },
        `${online}/${total}`,
      ),
    );
  }

  body() {
    if (this.loading) return this.message("Checking Ollama servers...");
    if (this.error) return this.message(this.error, true);

    return h(
      "div",
      { class: "flex flex-col gap-3 p-2.5" },
      this.store.ollamaInstalled === false ? this.missingBanner() : null,
      this.status ? this.statusLine() : null,
      this.serverSection(),
      this.selectedServer ? this.detailSection() : null,
    );
  }

  missingBanner() {
    return h(
      "div",
      {
        class:
          "flex flex-col gap-1.5 rounded-md border border-[color:var(--muxy-diff-remove)] bg-surface px-2.5 py-2",
      },
      h(
        "div",
        {
          class:
            "flex items-center gap-1.5 text-[11px] font-medium text-[color:var(--muxy-diff-remove)]",
        },
        icon("alert", 12),
        "ollama not found on PATH",
      ),
      h(
        "div",
        { class: "text-[11px] text-muted-foreground" },
        "Install it (for example: brew install ollama), then retry.",
      ),
      h(
        "button",
        {
          type: "button",
          class:
            "self-start rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-muted-foreground outline-none transition-colors hover:border-primary hover:text-foreground",
          onclick: () => this.refresh(),
        },
        "Retry",
      ),
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

  serverSection() {
    if (this.store.servers.length === 0) {
      return h(
        "div",
        { class: "flex flex-col items-center gap-2 px-4 py-6 text-center" },
        h("div", { class: "text-[12px] text-muted-foreground" }, "No Ollama servers yet."),
        h(
          "button",
          {
            type: "button",
            class:
              "rounded-md border border-primary bg-accent px-2.5 py-1 text-[11px] text-foreground outline-none",
            onclick: () => this.promptAddServer(),
          },
          "Add server",
        ),
      );
    }

    return h(
      "div",
      { class: "flex flex-col gap-1.5" },
      h("div", { class: "px-0.5 text-[11px] font-medium text-muted-foreground" }, "Servers"),
      this.store.servers.map((server) => this.serverRow(server)),
    );
  }

  serverRow(server) {
    const status = this.store.statusOf(server.id);
    const models = this.store.modelsOf(server.id);
    const selected = this.selectedServer && this.selectedServer.id === server.id;
    const isDefault = this.store.defaults.serverId === server.id;

    const dotClass =
      status.online === true
        ? "bg-[color:var(--muxy-diff-add)]"
        : status.online === false
          ? "bg-[color:var(--muxy-diff-remove)]"
          : "bg-[color:var(--muxy-foreground-muted)]";

    const meta = [
      server.url,
      status.version ? `v${status.version}` : null,
      status.online === false ? status.error : null,
      models.items.length > 0 ? `${models.items.length} models` : null,
    ]
      .filter(Boolean)
      .join(" - ");

    return h(
      "div",
      {
        class: cls(
          "flex items-stretch overflow-hidden rounded-md border bg-surface transition-colors",
          selected ? "border-primary" : "border-border hover:border-primary",
        ),
      },
      h(
        "button",
        {
          type: "button",
          class:
            "flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left outline-none hover:bg-accent",
          onclick: () => this.selectServer(server.id),
        },
        h("span", {
          class: cls("h-2 w-2 shrink-0 rounded-full", dotClass),
          title:
            status.online === true
              ? "Online"
              : status.online === false
                ? status.error || "Offline"
                : "Not checked yet",
        }),
        h(
          "div",
          { class: "flex min-w-0 flex-col" },
          h(
            "div",
            { class: "flex items-center gap-1.5" },
            h("span", { class: "truncate text-[12px] font-medium text-foreground" }, server.name),
            isDefault
              ? h(
                  "span",
                  {
                    class:
                      "rounded px-1 py-px text-[9px] uppercase text-muted-foreground ring-1 ring-border",
                  },
                  "default",
                )
              : null,
          ),
          h("span", { class: "truncate font-mono text-[10px] text-muted-foreground" }, meta),
        ),
      ),
      h(
        "button",
        {
          type: "button",
          title: "Rename",
          class:
            "flex w-7 shrink-0 items-center justify-center border-l border-border text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground",
          onclick: () => this.promptRename(server),
        },
        icon("pencil", 12),
      ),
      h(
        "button",
        {
          type: "button",
          title: "Remove",
          class:
            "flex w-7 shrink-0 items-center justify-center border-l border-border text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-[color:var(--muxy-diff-remove)]",
          onclick: () => this.confirmRemove(server),
        },
        icon("trash", 12),
      ),
    );
  }

  detailSection() {
    const server = this.selectedServer;
    const status = this.store.statusOf(server.id);
    const models = this.store.modelsOf(server.id);

    return h(
      "div",
      { class: "flex flex-col gap-2 border-t border-border pt-3" },
      status.online === false
        ? h(
            "div",
            {
              class: "flex items-center gap-1.5 text-[11px] text-[color:var(--muxy-diff-remove)]",
            },
            icon("alert", 12),
            status.error || "Offline",
          )
        : null,
      this.modelSearch(),
      models.stale
        ? h("div", { class: "text-[10px] text-muted-foreground" }, "Showing last-known models")
        : null,
      this.modelList(),
      this.agentPicker(),
      this.extraArgsInput(),
      this.launchButton(),
    );
  }

  modelSearch() {
    return h(
      "div",
      { class: "flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1" },
      icon("search", 12, "text-muted-foreground"),
      h("input", {
        type: "text",
        "data-focus": "model-search",
        value: this.modelQuery,
        placeholder: "Search models",
        class: "min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none",
        oninput: (event) => {
          this.modelQuery = event.target.value;
          this.replaceModelList();
        },
      }),
    );
  }

  replaceModelList() {
    const previous = this.modelListNode;
    if (!previous || !previous.parentNode) return;
    const next = this.modelList();
    previous.parentNode.replaceChild(next, previous);
  }

  modelList() {
    const models = this.visibleModels;
    const selected = this.store.selectedModel();

    const node =
      models.length === 0
        ? h(
            "div",
            { class: "px-1 py-2 text-[11px] text-muted-foreground" },
            this.modelQuery ? "No matching models." : "No models on this server.",
          )
        : h(
            "div",
            { class: "flex max-h-52 flex-col gap-1 overflow-y-auto" },
            models.map((model) =>
              h(
                "button",
                {
                  type: "button",
                  class: cls(
                    "flex flex-col items-start rounded-md border px-2 py-1 text-left outline-none transition-colors",
                    model.name === selected
                      ? "border-primary bg-accent"
                      : "border-transparent hover:border-border hover:bg-accent",
                  ),
                  onclick: () => this.selectModel(model.name),
                },
                h("span", { class: "truncate font-mono text-[11px] text-foreground" }, model.name),
                modelSubtitle(model)
                  ? h("span", { class: "text-[10px] text-muted-foreground" }, modelSubtitle(model))
                  : null,
              ),
            ),
          );

    this.modelListNode = node;
    return node;
  }

  agentPicker() {
    const agents = this.store.agents;
    const selected = this.store.defaults.agent;

    if (agents.length === 0) {
      return h(
        "div",
        { class: "text-[11px] text-muted-foreground" },
        this.store.agentsError || "No integrations available.",
      );
    }

    return h(
      "div",
      { class: "flex flex-col gap-1" },
      h("span", { class: "text-[10px] uppercase text-muted-foreground" }, "Integration"),
      h(
        "select",
        {
          class:
            "w-full rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-foreground outline-none",
          onchange: (event) => this.selectAgent(event.target.value),
        },
        agents.map((agent) =>
          h(
            "option",
            {
              value: agent.name,
              selected: agent.name === selected,
              title: agent.aliases.length > 0 ? `aliases: ${agent.aliases.join(", ")}` : agent.label,
            },
            `${agent.name} - ${agent.label}`,
          ),
        ),
      ),
    );
  }

  extraArgsInput() {
    return h("input", {
      type: "text",
      value: this.store.defaults.extraArgs || "",
      placeholder: "Extra args after -- (optional)",
      class:
        "w-full rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-foreground outline-none",
      onchange: (event) => this.setExtraArgs(event.target.value),
    });
  }

  launchButton() {
    const server = this.selectedServer;
    const agent = this.store.defaults.agent;
    const model = this.store.selectedModel();
    const disabled = this.launching || !server || !agent || !model;

    return h(
      "button",
      {
        type: "button",
        disabled,
        class: cls(
          "inline-flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] outline-none transition-colors",
          disabled
            ? "border-border bg-surface text-muted-foreground opacity-50"
            : "border-primary bg-accent text-foreground hover:bg-surface",
        ),
        onclick: () => this.launch(),
      },
      icon("terminal", 12),
      this.launching ? "Launching..." : "Launch in new terminal",
    );
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
