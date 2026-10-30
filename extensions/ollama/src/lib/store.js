import {
  DEFAULT_SERVER,
  HELP_TIMEOUT_MS,
  PROBE_TIMEOUT_MS,
  TAGS_MAX_TIME,
  VERSION_MAX_TIME,
  curlExitReason,
  errMessage,
  hostLabel,
  isMissingBinary,
  makeId,
  normalizeBaseUrl,
  parseIntegrations,
  parseModels,
  safeJsonParse,
} from "@/lib/ollama";

const SERVERS_KEY = "servers";
const DEFAULTS_KEY = "defaults";

export class OllamaStore {
  constructor() {
    this.servers = [];
    this.status = new Map();
    this.models = new Map();
    this.agents = [];
    this.agentsError = null;
    this.ollamaInstalled = null;
    this.defaults = { serverId: null, agent: null, extraArgs: "", modelsByServer: {} };
    this.generation = 0;
    this.polling = false;
    this.pollPromise = null;
  }

  async load() {
    const stored = await muxy.storage.get(SERVERS_KEY);
    if (Array.isArray(stored)) {
      this.servers = stored.filter((server) => server && server.id && server.url);
    } else {
      const url = normalizeBaseUrl(DEFAULT_SERVER.url);
      this.servers = [{ id: makeId(), name: DEFAULT_SERVER.name, url, createdAt: Date.now() }];
      await this.persistServers();
    }

    const defaultsRaw = await muxy.storage.get(DEFAULTS_KEY);
    if (defaultsRaw && typeof defaultsRaw === "object") {
      const modelsByServer =
        defaultsRaw.modelsByServer && typeof defaultsRaw.modelsByServer === "object"
          ? { ...defaultsRaw.modelsByServer }
          : defaultsRaw.model
            ? { [defaultsRaw.serverId || "unknown"]: defaultsRaw.model }
            : {};
      this.defaults = {
        serverId: defaultsRaw.serverId || null,
        agent: defaultsRaw.agent || null,
        extraArgs: defaultsRaw.extraArgs || "",
        modelsByServer,
      };
    }
    if (!this.servers.some((server) => server.id === this.defaults.serverId)) {
      this.defaults.serverId = this.servers[0]?.id || null;
    }
  }

  persistServers() {
    return muxy.storage.set(SERVERS_KEY, this.servers);
  }

  persistDefaults() {
    return muxy.storage.set(DEFAULTS_KEY, this.defaults);
  }

  server(id) {
    return this.servers.find((server) => server.id === id) || null;
  }

  statusOf(id) {
    return this.status.get(id) || { online: null, version: null, error: null };
  }

  modelsOf(id) {
    return this.models.get(id) || { items: [], stale: false };
  }

  serverModel(id) {
    const value = this.defaults.modelsByServer[id];
    return typeof value === "string" && value ? value : null;
  }

  selectedModel() {
    return this.defaults.serverId ? this.serverModel(this.defaults.serverId) : null;
  }

  setServerModel(id, name) {
    if (name) this.defaults.modelsByServer[id] = name;
    else delete this.defaults.modelsByServer[id];
    return this.persistDefaults();
  }

  async addServer(rawUrl, rawName) {
    const url = normalizeBaseUrl(rawUrl);
    if (!url) return { ok: false, error: "Enter a valid http(s) URL, e.g. http://192.168.1.49:11434" };
    if (this.servers.some((server) => server.url === url)) {
      return { ok: false, error: "That server is already in the list" };
    }
    const name = String(rawName || "").trim() || hostLabel(url);
    const server = { id: makeId(), name, url, createdAt: Date.now() };
    this.servers.push(server);
    this.defaults.serverId = server.id;
    await this.persistServers();
    await this.persistDefaults();
    await this.probe(server, ++this.generation);
    return { ok: true, server };
  }

  async renameServer(id, rawName) {
    const server = this.server(id);
    const name = String(rawName || "").trim();
    if (!server || !name) return false;
    server.name = name;
    await this.persistServers();
    return true;
  }

  async removeServer(id) {
    const index = this.servers.findIndex((server) => server.id === id);
    if (index === -1) return false;
    this.servers.splice(index, 1);
    this.status.delete(id);
    this.models.delete(id);
    if (this.defaults.serverId === id) {
      this.defaults.serverId = this.servers[0]?.id || null;
      await this.persistDefaults();
    }
    await this.persistServers();
    return true;
  }

  async setDefaults(patch) {
    this.defaults = { ...this.defaults, ...patch };
    await this.persistDefaults();
  }

  async curl(url, maxTime) {
    return muxy.exec(["curl", "-sf", "--max-time", maxTime, url], {
      timeoutMs: PROBE_TIMEOUT_MS,
    });
  }

  async probe(server, generation) {
    let version;
    try {
      version = await this.curl(`${server.url}/api/version`, VERSION_MAX_TIME);
    } catch (err) {
      this.status.set(server.id, { online: false, version: null, error: errMessage(err) });
      this.markStale(server.id);
      return;
    }
    if (generation !== this.generation) return;

    if (version.exitCode !== 0) {
      this.status.set(server.id, {
        online: false,
        version: null,
        error: curlExitReason(version.exitCode),
      });
      this.markStale(server.id);
      return;
    }

    this.status.set(server.id, {
      online: true,
      version: safeJsonParse(version.stdout)?.version || null,
      error: null,
    });

    let tags;
    try {
      tags = await this.curl(`${server.url}/api/tags`, TAGS_MAX_TIME);
    } catch (err) {
      this.markStale(server.id);
      return;
    }
    if (generation !== this.generation) return;

    if (tags.exitCode === 0) {
      this.models.set(server.id, { items: parseModels(tags.stdout), stale: false });
    } else {
      this.markStale(server.id);
    }
  }

  markStale(id) {
    const current = this.models.get(id);
    if (current && current.items.length > 0) this.models.set(id, { ...current, stale: true });
  }

  pollAll() {
    if (this.polling) return this.pollPromise;
    this.polling = true;
    const generation = ++this.generation;
    this.pollPromise = Promise.all(this.servers.map((server) => this.probe(server, generation))).finally(() => {
      this.polling = false;
    });
    return this.pollPromise;
  }

  async refreshAgents() {
    let result;
    try {
      result = await muxy.exec(["ollama", "launch", "--help"], { timeoutMs: HELP_TIMEOUT_MS });
    } catch (err) {
      const message = errMessage(err);
      this.agentsError = message;
      if (isMissingBinary(message)) this.ollamaInstalled = false;
      return;
    }

    const combined = `${result.stdout || ""}\n${result.stderr || ""}`;
    if (result.exitCode === 127 || /command not found|not recognized/i.test(combined)) {
      this.ollamaInstalled = false;
      this.agentsError = "ollama was not found on PATH";
      return;
    }

    const parsed = parseIntegrations(result.stdout);
    if (parsed.length > 0) {
      this.agents = parsed;
      this.ollamaInstalled = true;
      this.agentsError = null;
    } else {
      this.agentsError = "Could not read the integration list from ollama launch --help";
    }
  }

  onlineCount() {
    return this.servers.filter((server) => this.statusOf(server.id).online === true).length;
  }
}
