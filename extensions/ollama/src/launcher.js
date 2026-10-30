import { clear, h } from "@/lib/dom";
import {
  buildLaunchCommand,
  errMessage,
  hostLabel,
  parseIntegrations,
  parseModels,
  shellQuote,
} from "@/lib/ollama";
import "@/styles/global.css";

const muxy = window.muxy;
const root = document.getElementById("root");

let servers = [];
let agents = [];
let defaults = { serverId: null, agent: null, extraArgs: "", modelsByServer: {} };
let modelList = []; // candidate model names for the currently selected server
let loadingModels = false;
let launching = false;

async function init() {
  const data = muxy.data && typeof muxy.data === "object" ? muxy.data : {};
  servers = Array.isArray(data.servers) ? data.servers : [];
  agents = Array.isArray(data.agents) ? data.agents : [];
  defaults = data.defaults && typeof data.defaults === "object" ? data.defaults : defaults;

  // Fallbacks for a context where the opener didn't fully hydrate us.
  let storageServers = null;
  let storageDefaults = null;
  if (servers.length === 0) {
    storageServers = await muxy.storage.get("servers").catch(() => null);
  }
  if ((!defaults.agent && !defaults.serverId) && !data.defaults) {
    storageDefaults = await muxy.storage.get("defaults").catch(() => null);
  }
  if ((servers.length === 0 || storageServers) && Array.isArray(storageServers) && storageServers.length > 0) {
    servers = storageServers;
  }
  if (storageDefaults && typeof storageDefaults === "object") {
    defaults = storageDefaults;
  }

  // If the panel didn't hand us a cached agent list (e.g. command palette before first open),
  // read it straight from `ollama launch --help` so the picker still works.
  if (agents.length === 0) {
    agents = await loadAgentsList();
  }

  // Defaults the launcher must start from: prefer the caller's pick, else the stored preference.
  const defaultServerId = defaults.serverId || servers[0]?.id || null;
  const defaultModel = defaultServerId
    ? defaults.modelsByServer && defaults.modelsByServer[defaultServerId]
    : null;
  state = {
    serverId: defaultServerId,
    agent: defaults.agent || agents[0]?.name || null,
    model: typeof defaultModel === "string" ? defaultModel : "",
    extraArgs: defaults.extraArgs || "",
  };

  if (servers.length === 0) {
    renderMessage("No Ollama servers configured. Add one in the Ollama panel first.");
    return;
  }
  if (agents.length === 0) {
    renderMessage("No integrations found. Make sure ollama is installed and on PATH, then retry.");
    return;
  }

  render();
  loadModels(state.serverId, (list) => {
    // Only the datalist/label needs refreshing after the first paint; typing survives.
    renderModelOptions(list);
  });
}

function renderMessage(text) {
  clear(root);
  root.appendChild(
    h("div", { class: "flex flex-col gap-3 p-4" },
      h("div", { class: "text-[12px] text-muted-foreground" }, text),
      actions("Close"),
    ),
  );
}

function label(id, text) {
  return h("span", { class: "text-[10px] uppercase text-muted-foreground" }, text);
}

function render() {
  const server = servers.find((s) => s.id === state.serverId) || servers[0];
  const model = state.model;
  const agent = state.agent || "";
  const extra = String(state.extraArgs || "").trim();

  clear(root);
  root.appendChild(
    h("div", { class: "flex flex-col gap-3 p-3" },
      h("div", { class: "text-[11px] font-semibold uppercase text-muted-foreground" }, "Launch agent"),
      h("div", { class: "flex flex-col gap-1" },
        label("srv", "Server"),
        h("select", {
          id: "server",
          class: selectCls,
          onchange: (event) => selectServer(event.target.value),
        },
          servers.map((s) =>
            h("option", {
              value: s.id,
              selected: s.id === server.id,
            }, `${s.name} · ${hostLabel(s.url)}`)),
        ),
      ),
      h("div", { class: "flex flex-col gap-1" },
        label("agent", "Integration"),
        h("select", {
          id: "agent",
          class: selectCls,
          onchange: (event) => selectAgent(event.target.value),
        },
          agents.map((a) =>
            h("option", {
              value: a.name,
              selected: a.name === state.agent,
              title: a.aliases && a.aliases.length > 0 ? `aliases: ${a.aliases.join(", ")}` : a.label,
            }, `${a.name} - ${a.label}`)),
        ),
      ),
      h("div", { class: "flex flex-col gap-1" },
        label("model", "Model"),
        h("input", {
          id: "model",
          type: "text",
          list: "models",
          value: state.model,
          placeholder: "e.g. llama3.2",
          class: inputCls,
          oninput: (event) => setModel(event.target.value),
        }),
        h("datalist", { id: "models" },
          modelList.map((m) => h("option", { value: m }))),
        h("div", { id: "model-status", class: "text-[10px] text-muted-foreground" },
          loadingModels ? "Loading models…" : modelList.length === 0 ? "Type any model name" : `${modelList.length} models`),
      ),
      h("div", { class: "flex flex-col gap-1" },
        label("extra", "Extra args"),
        h("input", {
          id: "extra",
          type: "text",
          value: state.extraArgs || "",
          placeholder: "Extra args after -- (optional)",
          class: inputCls,
          oninput: (event) => setExtra(event.target.value),
        }),
      ),
      h("div", { class: "flex flex-col gap-1" },
        label("cmd", "Command"),
        h("pre", {
          class: "overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-[10px] text-muted-foreground",
        }, commandPreview(server, agent, model, extra)),
      ),
      h("div", { id: "error", class: "hidden text-[11px] text-[color:var(--muxy-diff-remove)]" }),
      h("div", { class: "mt-1 flex items-center justify-end gap-2" },
        h("button", {
          type: "button",
          id: "cancel",
          class: "rounded-md border border-border bg-surface px-2.5 py-1 text-[11px] text-muted-foreground outline-none hover:border-primary hover:text-foreground",
        }, "Cancel"),
        h("button", {
          type: "button",
          id: "launch",
          class: "rounded-md border border-primary bg-accent px-2.5 py-1 text-[11px] font-medium text-foreground outline-none hover:bg-surface",
        }, "Launch"),
      ),
    ),
  );

  document.getElementById("cancel").onclick = closeQuiet;
  document.getElementById("launch").onclick = launch;
  // Keep typing responsive: model input only rebuilds datalist/status, other fields stay put.
}

function commandPreview(server, agent, model, extra) {
  // Mirror buildLaunchCommand for the preview so the user sees exactly what will run.
  const parts = [`OLLAMA_HOST=${shellQuote(server.url)}`, "ollama", "launch", shellQuote(agent)];
  if (model) parts.push("--model", shellQuote(model));
  if (extra) parts.push("--", extra);
  return parts.join(" ");
}

// ---- live state, updated without a full re-render that would drop focus -------
let state = { serverId: null, agent: null, model: "", extraArgs: "" };

function setModel(value) {
  state.model = value;
  updateCommandPreview();
}
function setExtra(value) {
  state.extraArgs = value;
  updateCommandPreview();
}
function selectServer(id) {
  state.serverId = id;
  const model = defaults.modelsByServer ? defaults.modelsByServer[id] : null;
  if (typeof model === "string") state.model = model;
  updateModelStatus("Loading models…");
  loadModels(id, (list) => {
    renderModelOptions(list);
  });
  updateCommandPreview();
}
function selectAgent(name) {
  state.agent = name;
  updateCommandPreview();
}

function renderModelOptions(list) {
  modelList = list;
  const datalist = document.getElementById("models");
  if (datalist) {
    datalist.replaceChildren(...list.map((m) => h("option", { value: m })));
  }
  updateModelStatus(list.length === 0 ? "Type any model name" : `${list.length} models`);
}

function updateModelStatus(text) {
  const node = document.getElementById("model-status");
  if (node) node.textContent = text;
  loadingModels = false;
}

function updateCommandPreview() {
  const server = servers.find((s) => s.id === state.serverId) || servers[0];
  const preview = document.getElementById("root").querySelector("pre");
  if (preview) {
    preview.textContent = commandPreview(server, state.agent, state.model, state.extraArgs);
  }
}

async function loadAgentsList() {
  try {
    const res = await muxy.exec(["ollama", "launch", "--help"], { timeoutMs: 8000 });
    const combined = `${res.stdout || ""}\n${res.stderr || ""}`;
    if (res.exitCode === 127 || /command not found|not recognized/i.test(combined)) return [];
    return parseIntegrations(res.stdout);
  } catch {
    return [];
  }
}

async function loadModels(serverId, done) {
  const server = servers.find((s) => s.id === serverId);
  if (!server) {
    modelList = [];
    if (done) done([]);
    return;
  }
  loadingModels = true;
  try {
    const res = await muxy.exec(["curl", "-sf", "--max-time", "4", `${server.url}/api/tags`], {
      timeoutMs: 5000,
    });
    const list = res && res.exitCode === 0 ? parseModels(res.stdout).map((m) => m.name) : [];
    modelList = list;
    if (done) done(list);
  } catch {
    modelList = [];
    if (done) done([]);
  } finally {
    loadingModels = false;
  }
}

async function launch() {
  const server = servers.find((s) => s.id === state.serverId) || servers[0];
  if (!server || !state.agent) return;
  launching = true;
  const launchBtn = document.getElementById("launch");
  if (launchBtn) launchBtn.disabled = true;

  const command = buildLaunchCommand({ url: server.url, agent: state.agent, model: state.model, extraArgs: state.extraArgs });
  try {
    await muxy.tabs.open({ kind: "terminal", command });
    // Persist the choices back so the panel (and next launch) remember them.
    try {
      await muxy.storage.set("defaults", {
        ...defaults,
        serverId: server.id,
        agent: state.agent,
        extraArgs: state.extraArgs,
        modelsByServer: {
          ...(defaults.modelsByServer || {}),
          ...(state.model ? { [server.id]: state.model } : {}),
        },
      });
    } catch {
      /* persistence is best-effort */
    }
    muxy.notifications.notify?.({ title: "Ollama", body: `Launched ${state.agent} on ${server.name}` });
    if (muxy.modal && muxy.modal.submitWebview) muxy.modal.submitWebview({ launched: true });
    else muxy.lifecycle.close();
  } catch (err) {
    const node = document.getElementById("error");
    if (node) {
      node.textContent = errMessage(err);
      node.classList.remove("hidden");
    }
    launching = false;
    if (launchBtn) launchBtn.disabled = false;
  }
}

function closeQuiet() {
  // Dismiss (opener receives null) without claiming a launch.
  muxy.lifecycle.close();
}

function actions(primaryLabel) {
  return h(
    "div",
    { class: "flex items-center justify-end gap-2" },
    h("button", {
      type: "button",
      onclick: closeQuiet,
      class: "rounded-md border border-border bg-surface px-2.5 py-1 text-[11px] text-muted-foreground outline-none hover:border-primary hover:text-foreground",
    }, primaryLabel),
  );
}

const selectCls =
  "w-full rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-foreground outline-none";
const inputCls =
  "w-full rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-foreground outline-none";

init();
