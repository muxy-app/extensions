import { ServiceHistory } from './observation.js';
import { contextFrom, sameContext } from './model.js';
import { SCAN_SCRIPT, parseSnapshot, stopTreeScript, groupServices, stopRestriction, insideDirectory, defaultURL, validateURL } from './processes.js';

export class ServiceMonitor {
  constructor(api, changed = () => {}, { commands = null, now = () => Date.now() } = {}) {
    this.commands = commands; this.now = now; this.history = new ServiceHistory();
    this.api = api;
    this.changed = changed;
    this.state = { status: 'loading', context: null, services: [], checkedAt: null, error: '', busy: new Set(), limited: false };
    this.snapshot = null;
    this.job = null;
    this.stopping = false;
    this.refreshAfterStop = false;
    this.urls = null;
    this.urlWrite = Promise.resolve();
    this.disposed = false;
    this.generation = 0;
  }

  notify() { if (!this.disposed) this.changed(); }

  invalidate() {
    this.generation++;
    this.state.status = 'loading';
    this.notify();
  }

  async context() {
    const projects = await this.api.projects.list();
    const active = projects.find(project => project.isActive);
    if (!active) throw new Error('Open a local project in Muxy to inspect services.');
    const trees = await this.api.worktrees.list(active.id);
    return contextFrom(projects, trees);
  }

  async assertContext(context, generation = this.generation) {
    const current = await this.context();
    if (this.disposed || generation !== this.generation || !sameContext(current, context)) {
      throw new Error('The workspace changed. Refresh before continuing.');
    }
  }

  refresh({ quiet = false, signal } = {}) {
    if (this.disposed) return Promise.resolve();
    if (this.stopping) {
      // Automatic requests belong to the foreground scheduler. Deferring one
      // here would outlive its scheduler job and lose later focus cancellation.
      if (!signal) this.refreshAfterStop = true;
      return Promise.resolve();
    }
    if (this.job) return this.job;
    const generation = ++this.generation;
    if (!quiet || !this.state.checkedAt) this.state.status = 'loading';
    this.state.checking = true;
    this.state.error = '';
    this.notify();
    this.job = this.inspect(generation, signal).catch(error => {
      if (!this.disposed && generation === this.generation) {
        this.state.status = 'error';
        this.state.error = error.message;
      }
    }).finally(() => { this.job = null; this.state.checking = false; this.notify(); });
    return this.job;
  }

  async inspect(generation, signal, attempts = 0) {
    signal?.throwIfAborted();
    const context = await this.context();
    signal?.throwIfAborted();
    if (this.disposed || generation !== this.generation) return;
    if (!sameContext(context, this.state.context)) {
      this.state.services = [];
      this.state.checkedAt = null;
      this.state.hostname = null;
      this.state.limited = false;
      this.snapshot = null;
    }
    this.state.context = context;
    if (!this.urls) {
      const saved = await this.api.storage.get('service-urls/v1');
      this.urls = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    }
    signal?.throwIfAborted();
    if (this.disposed || generation !== this.generation) return;
    const result = await this.api.exec({ shell: SCAN_SCRIPT, timeoutMs: 5000 });
    signal?.throwIfAborted();
    if (this.disposed || generation !== this.generation) return;
    const current = await this.context();
    signal?.throwIfAborted();
    if (!sameContext(context, current)) {
      if (attempts < 2) return this.inspect(generation, signal, attempts + 1);
      throw new Error('The workspace changed. Refresh before continuing.');
    }
    if (generation === this.generation) this.accept(result, context);
  }

  accept(result, context) {
    if (result.timedOut || result.truncated || result.exitCode !== 0 || result.stderr?.trim()) {
      throw new Error(result.exitCode === 69 ? 'Service inspection requires macOS on the execution host.'
        : result.timedOut ? 'Service inspection timed out. Refresh to try again.'
          : 'Service inspection failed or was incomplete. Refresh to try again.');
    }
    const snapshot = parseSnapshot(result.stdout);
    this.snapshot = snapshot;
    const services = groupServices(snapshot, this.commands && sameContext(this.commands.context, context) ? this.commands.entries : []);
    const legacyKeys = new Map();
    for (const service of services) {
      const key = this.urlKey(service, true);
      legacyKeys.set(key, (legacyKeys.get(key) || 0) + 1);
    }
    this.state.services = services.map(service => {
      const legacyKey = this.urlKey(service, true);
      let customURL = this.urls?.[this.urlKey(service)]
        ?? (legacyKeys.get(legacyKey) === 1 ? this.urls?.[legacyKey] : null);
      try { if (customURL) customURL = validateURL(customURL); } catch { customURL = null; }
      return { ...service, inProject: insideDirectory(service.cwd, context.path),
        restriction: service.restriction || stopRestriction(service, snapshot.uid),
        ...this.history.observe(service, snapshot.hostId, this.now()),
        terminalAvailable: !!service.source?.tabId && !!this.commands?.tabs.some(tab => tab.id === service.source.tabId && tab.kind === 'terminal'),
        url: customURL || defaultURL(service), customURL: !!customURL };
    }).sort((a, b) => Number(b.inProject) - Number(a.inProject) || a.ports[0].port - b.ports[0].port);
    this.state.status = 'ready';
    this.state.error = '';
    this.state.checkedAt = new Date(this.now());
    this.state.limited = snapshot.limited;
    this.state.hostname = snapshot.hostname;
  }

  service(id) {
    const service = this.state.services.find(item => item.id === id);
    if (this.disposed || !service || this.state.status !== 'ready') throw new Error('Refresh services before continuing.');
    return service;
  }

  async exclusive(id, action) {
    if (this.disposed || this.state.busy.has(id)) return;
    this.state.busy.add(id);
    this.notify();
    try { return await action(); }
    finally { this.state.busy.delete(id); this.notify(); }
  }

  urlKey(service, legacy = false) {
    const endpoints = [...service.ports].sort((a, b) => a.port - b.port)
      .map(item => legacy ? item.port : [item.port, [...new Set(item.hosts)].sort()]);
    return 'service-url/' + encodeURIComponent(JSON.stringify([this.snapshot.hostname, service.cwd, service.executable, endpoints]));
  }

  open(id, { url: customURL, confirmHost = async () => false } = {}) {
    return this.exclusive(id, async () => {
      if (this.job) await this.job;
      const service = this.service(id);
      const context = this.state.context;
      const generation = this.generation;
      const key = this.urlKey(service);
      const legacyKey = this.urlKey(service, true);
      const url = validateURL(customURL ?? service.url);
      const hostKey = 'browser-host/' + this.snapshot.hostId;
      if (customURL === undefined && !service.customURL && !await this.api.storage.get(hostKey)) {
        if (this.disposed || generation !== this.generation) throw new Error('The workspace changed. Refresh before continuing.');
        if (!await confirmHost(this.snapshot.hostname)) return;
        await this.assertContext(context, generation);
        await this.api.storage.set(hostKey, true);
      }
      await this.assertContext(context, generation);
      await this.api.browser.open(url);
      if (customURL !== undefined) {
        // Different rows share this persisted map; merge after the prior write.
        const write = this.urlWrite.then(async () => {
          const urls = { ...this.urls };
          delete urls[legacyKey]; delete urls[key]; urls[key] = url;
          const bounded = Object.fromEntries(Object.entries(urls).slice(-100));
          await this.api.storage.set('service-urls/v1', bounded);
          this.urls = bounded;
        });
        this.urlWrite = write.catch(() => {});
        await write;
        service.url = url; service.customURL = true;
      }
      return url;
    });
  }

  async terminal(id) {
    if (this.job) await this.job;
    const service = this.service(id);
    if (!service.source?.entryId || !this.commands) throw new Error('No verified terminal association.');
    const context = this.state.context;
    await this.assertContext(context);
    await this.commands.terminal(service.source.entryId, context, service.source.token);
  }

  async performStop(service, context, snapshot, observedGeneration) {
    await this.assertContext(context, observedGeneration);
    const generation = ++this.generation;
    const result = await this.api.exec({ shell: stopTreeScript(service, snapshot), timeoutMs: 15000 });
    await this.assertContext(context);
    if (this.disposed || generation !== this.generation) throw new Error('Inspection was superseded. Refresh before continuing.');
    if ([71, 72].includes(result.exitCode)) throw new Error('The process tree or host changed. Refresh before trying again; no restart was started.');
    if (result.exitCode === 73) throw new Error('The process could not be stopped. Check its terminal.');
    this.accept(result, context);
    const remaining = this.snapshot.processes.some(p => service.members.some(old => old.id === p.id));
    const replacement = this.snapshot.services.some(p => p.ports.some(port => service.ports.some(old => old.port === port.port)));
    return { outcome: remaining ? 'stillRunning' : replacement ? 'replaced' : 'stopped' };
  }

  stop(id, confirm = async () => true) { return this.changeProcess(id, confirm, false); }
  restart(id, confirm = async () => true) { return this.changeProcess(id, confirm, true); }

  changeProcess(id, confirm, restarting) {
    return this.exclusive(id, async () => {
      if (this.stopping) return;
      this.service(id);
      // Reserve the mutation before waiting: another service may share this scan.
      this.stopping = true;
      try {
        if (this.job) await this.job;
        const service = this.service(id);
        const context = this.state.context;
        const snapshot = this.snapshot;
        const generation = this.generation;
        if (service.restriction) throw new Error('This process cannot be stopped from Run Deck.');
        if (restarting && (!service.source?.entryId || !this.commands)) throw new Error('A verified Run Deck launch is required to restart.');
        if (!service.inProject && !await confirm(service)) return { cancelled: true };
        this.history.forget(service, snapshot.hostId);
        if (!restarting) return await this.performStop(service, context, snapshot, generation);
        const entry = await this.commands.restart(service.source.entryId, service.source.token, async () => {
          const result = await this.performStop(service, context, snapshot, generation);
          if (result.outcome !== 'stopped') throw new Error('The old service or its port is still active. Restart cancelled.');
          return { hostId: snapshot.hostId, uid: snapshot.uid, members: service.members, ports: service.ports };
        });
        return { outcome: 'restartRequested', entryId: entry.id };
      } catch (error) {
        this.state.status = 'error'; this.state.error = error.message; throw error;
      } finally {
        this.stopping = false;
        if (this.refreshAfterStop) { this.refreshAfterStop = false; await this.refresh(); }
      }
    });
  }

  dispose() { this.disposed = true; this.generation++; }
}
