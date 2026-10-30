import { launchCommand } from './processes.js';
import { MAX_COMMANDS, validateEntry, decodeRecord, scopeKey, contextFrom, sameContext, terminalState, detectScripts, matchingCommand } from './model.js';

function sameAssociation(a, b) {
  if (!a || !b) return a === b;
  return ['state', 'token', 'tabId', 'paneId', 'requestedAt'].every(key => a[key] === b[key]);
}

export class Launchpad {
  constructor(api, changed = () => {}) {
    this.api = api;
    this.changed = changed;
    this.context = null;
    this.entries = [];
    this.tabs = [];
    this.busy = new Set();
    this.unsubscribers = [];
    this.disposed = false;
    this.epoch = 0;
    this.contextVersion = 0;
    this.refreshJob = null;
    this.pendingRead = 0; // 1: terminal availability, 2: saved commands and context
    this.readingFull = false;
    this.visible = true;
    this.error = '';
  }

  async currentContext(check = () => {}) {
    check();
    const projects = await this.api.projects.list();
    check();
    const active = projects.find(p => p.isActive);
    if (!active) throw new Error('Open a project in Muxy first.');
    const worktrees = await this.api.worktrees.list(active.id);
    check();
    return contextFrom(projects, worktrees);
  }

  async assertContext(expected = this.context, { signal } = {}) {
    const version = this.contextVersion;
    const check = () => {
      signal?.throwIfAborted();
      if (this.disposed || version !== this.contextVersion) throw new Error('Workspace changed. Refresh Run Deck and try again.');
    };
    const current = await this.currentContext(check);
    check();
    if (!sameContext(expected, current)) {
      throw new Error('Workspace changed. Refresh Run Deck and try again.');
    }
  }

  subscribe() {
    for (const name of ['tab.created', 'tab.updated', 'tab.closed']) {
      this.unsubscribers.push(this.api.events.subscribe(name, (event = {}) => {
        if (this.disposed) return;
        if (event.projectID && this.context && event.projectID !== this.context.projectId) return;
        if (event.worktreeID && this.context && event.worktreeID !== this.context.worktreeId) return;
        if (!this.entries.some(entry => entry.run?.tabId && (!event.tabID || entry.run.tabId === event.tabID))) return;
        this.pendingRead = Math.max(this.pendingRead, 1);
        if (this.visible) this.refresh({ tabsOnly: true }).catch(error => this.report(error));
      }));
    }
    for (const name of ['project.switched', 'worktree.switched']) {
      this.unsubscribers.push(this.api.events.subscribe(name, () => {
        if (this.disposed) return;
        this.epoch++;
        this.contextVersion++;
        this.pendingRead = 2;
        this.context = null; this.entries = []; this.tabs = [];
        this.changed({ contextChanged: true });
        if (this.visible) this.refresh({ cached: true }).catch(error => this.report(error));
      }));
    }
  }

  setVisible(visible) {
    this.visible = visible;
    if (visible && this.pendingRead) this.refresh({ tabsOnly: true }).catch(error => this.report(error));
  }

  report(error) {
    if (this.disposed) return;
    this.error = error.message || String(error);
    this.changed();
  }

  refresh({ tabsOnly = false, cached = false } = {}) {
    if (this.disposed) return Promise.resolve();
    if (cached && !this.pendingRead && this.context) return this.refreshJob || Promise.resolve();
    if (this.refreshJob && (tabsOnly || this.readingFull)) return this.refreshJob;
    this.pendingRead = Math.max(this.pendingRead, tabsOnly ? 1 : 2);
    if (this.refreshJob) return this.refreshJob;
    // Batch synchronous event bursts, and keep callers waiting through a
    // context change instead of returning an obsolete in-flight read.
    this.refreshJob = Promise.resolve().then(async () => {
      if (this.disposed || (!this.visible && (tabsOnly || cached))) return;
      do {
        const full = this.pendingRead === 2;
        this.readingFull = full;
        this.pendingRead = 0;
        if (full) await this.readState(tabsOnly || cached); else await this.readTabs();
      } while (!this.disposed && this.visible && this.pendingRead);
    }).finally(() => { this.refreshJob = null; this.readingFull = false; });
    return this.refreshJob;
  }

  async readTabs() {
    const epoch = this.epoch;
    const tabs = await this.api.tabs.list();
    if (this.disposed) return;
    if (epoch !== this.epoch) { this.pendingRead = 2; return; }
    const previous = new Map(this.tabs.map(tab => [tab.id, tab.kind]));
    if (tabs.length === previous.size && tabs.every(tab => previous.get(tab.id) === tab.kind)) return;
    this.tabs = tabs;
    this.changed();
  }

  async readState(foregroundOnly = false) {
    const epoch = this.epoch;
    const context = await this.currentContext();
    if (this.disposed) return;
    if (foregroundOnly && !this.visible) { this.pendingRead = 2; return; }
    if (epoch !== this.epoch) { this.pendingRead = 2; return; }
    const prefix = scopeKey(context);
    const keys = (await this.api.storage.keys()).filter(key => key.startsWith(prefix));
    if (this.disposed) return;
    if (epoch !== this.epoch || foregroundOnly && !this.visible) { this.pendingRead = 2; return; }
    if (keys.length > MAX_COMMANDS) throw new Error(`This worktree exceeds the ${MAX_COMMANDS} command limit.`);
    const [records, tabs] = await Promise.all([
      Promise.all(keys.map(async key => decodeRecord(await this.api.storage.get(key), key.slice(prefix.length)))),
      this.api.tabs.list(),
    ]);
    if (this.disposed) return;
    if (foregroundOnly && !this.visible) { this.pendingRead = 2; return; }
    if (epoch !== this.epoch) { this.pendingRead = 2; return; }
    if (!sameContext(context, await this.currentContext())) { this.pendingRead = 2; return; }
    if (this.disposed || epoch !== this.epoch) { if (!this.disposed) this.pendingRead = 2; return; }
    this.context = context;
    this.tabs = tabs;
    this.entries = records.sort((a, b) => a.createdAt - b.createdAt);
    this.error = '';
    this.changed();
  }

  async exclusive(key, action) {
    if (this.busy.has(key)) return;
    this.busy.add(key);
    this.error = '';
    this.changed();
    try { return await action(); }
    catch (error) { this.report(error); throw error; }
    finally { this.busy.delete(key); if (!this.disposed) this.changed(); }
  }

  async persist(context, entry) {
    this.epoch++;
    await this.api.storage.set(scopeKey(context) + entry.id, entry);
    // Reads started while the host write was pending may still hold old data.
    this.epoch++;
    if (!this.disposed && sameContext(this.context, context)) {
      const index = this.entries.findIndex(item => item.id === entry.id);
      if (index < 0) this.entries.push(entry);
      else this.entries[index] = entry;
      this.changed();
    }
  }

  async save(input, id = null, expected = this.context) {
    return this.exclusive(id || 'new', async () => {
      await this.assertContext(expected);
      const fields = validateEntry(input);
      const key = id || crypto.randomUUID();
      const stored = id ? await this.api.storage.get(scopeKey(expected) + id) : null;
      if (id && !stored) throw new Error('This command was removed. Refresh first.');
      if (!id && (await this.api.storage.keys()).filter(k => k.startsWith(scopeKey(expected))).length >= MAX_COMMANDS) {
        throw new Error(`At most ${MAX_COMMANDS} commands per worktree.`);
      }
      const old = stored ? decodeRecord(stored, id) : null;
      if (old?.run && (old.command !== fields.command || old.directory !== fields.directory)) {
        throw new Error('Forget the terminal association before changing its command or directory.');
      }
      const entry = { version: 1, id: key, ...fields, createdAt: old?.createdAt || Date.now(), run: old?.run || null };
      await this.persist(expected, entry);
      return entry;
    });
  }

  async start(input, expected = this.context) {
    return this.exclusive('starter', async () => {
      const fields = validateEntry(input);
      await this.refresh();
      await this.assertContext(expected);
      let entry = matchingCommand(this.entries, fields);
      if (entry && terminalState(entry, this.tabs) === 'open') {
        await this.terminal(entry.id, expected);
        return { entry, action: 'terminal' };
      }
      if (!entry) entry = await this.save(fields, null, expected);
      // launch() preserves uncertain associations and rechecks persisted state.
      await this.assertContext(expected);
      const launched = await this.launch(entry.id, expected);
      return launched && { entry: launched, action: 'launch' };
    });
  }

  async launch(id, expected = this.context) {
    return this.exclusive(id, async () => {
      const context = expected;
      await this.assertContext(context);
      const entry = decodeRecord(await this.api.storage.get(scopeKey(context) + id), id);
      if (entry.run) throw new Error('This command already has a terminal association. Review or forget it first.');
      return this.openEntry(context, entry);
    });
  }

  async openEntry(context, entry, guard = null) {
    const staged = { ...entry, run: { state: 'opening', token: crypto.randomUUID(), tabId: null, requestedAt: Date.now() } };
    await this.persist(context, staged);
    let opened = false;
    try {
      await this.assertContext(context);
      const tabId = await this.api.tabs.open({ kind: 'terminal', directory: entry.directory, command: launchCommand(entry.command, staged.run.token, guard) });
      if (typeof tabId !== 'string' || !tabId) throw new Error('Muxy did not return a terminal ID. Review the terminal before retrying.');
      opened = true;
      const stored = await this.api.storage.get(scopeKey(context) + entry.id);
      if (!stored || !sameAssociation(stored.run, staged.run)) {
        throw new Error('Launch association changed while opening the terminal. Refresh before continuing.');
      }
      const current = decodeRecord(stored, entry.id);
      const linked = { ...current, run: { ...current.run, state: 'linked', tabId } };
      await this.persist(context, linked);
      // Read failures cannot undo a launch and association already confirmed.
      await this.refresh().catch(error => this.report(error));
      return linked;
    } catch (error) {
      try {
        const stored = await this.api.storage.get(scopeKey(context) + entry.id);
        // A late failure must not undo a linked, forgotten, or replaced run.
        if (stored && sameAssociation(stored.run, staged.run)) {
          const current = decodeRecord(stored, entry.id);
          await this.persist(context, { ...current, run: { ...current.run, state: 'unknown' } });
        }
      } catch {}
      throw new Error(`${error.message} ${opened ? 'A terminal was opened. ' : ''}Check Muxy before starting another instance.`);
    }
  }

  async restart(id, token, stop) {
    return this.exclusive(id, async () => {
      const context = this.context;
      await this.assertContext(context);
      const entry = decodeRecord(await this.api.storage.get(scopeKey(context) + id), id);
      if (entry.run?.state !== 'linked' || entry.run.token !== token) throw new Error('Launch association changed. Refresh before restarting.');
      await this.persist(context, { ...entry, run: { ...entry.run, state: 'restarting' } });
      let guard, current;
      try {
        guard = await stop(); await this.assertContext(context);
        current = decodeRecord(await this.api.storage.get(scopeKey(context) + id), id);
        if (current.run?.state !== 'restarting' || current.run.token !== token || current.command !== entry.command || current.directory !== entry.directory) {
          throw new Error('Launch association changed during restart. No replacement was started.');
        }
      } catch (error) {
        const current = await this.api.storage.get(scopeKey(context) + id);
        if (current?.run?.state === 'restarting' && current.run.token === token) {
          // Undo only our transition; preserve fields edited while stopping.
          await this.persist(context, { ...current, run: { ...current.run, state: entry.run.state } });
        }
        throw error;
      }
      return this.openEntry(context, current, guard);
    });
  }

  async terminal(id, expected = this.context, token = null) {
    const entry = this.entries.find(item => item.id === id);
    if (token !== null && entry?.run?.token !== token) throw new Error('Launch association changed. Refresh before opening its terminal.');
    await this.assertContext(expected);
    const tabs = await this.api.tabs.list();
    if (!entry || terminalState(entry, tabs) !== 'open') throw new Error('The linked terminal is no longer visible. Check Muxy background sessions.');
    const stored = await this.api.storage.get(scopeKey(expected) + id);
    if (!stored || !sameAssociation(decodeRecord(stored, id).run, entry.run)) {
      throw new Error('Launch association changed. Refresh before opening its terminal.');
    }
    await this.assertContext(expected);
    await this.api.tabs.switchTo(entry.run.tabId);
  }

  async forget(id, confirm) {
    return this.exclusive(id, async () => {
      const context = this.context;
      const entry = this.entries.find(item => item.id === id);
      if (!entry || !await confirm(entry)) return;
      await this.assertContext(context);
      const stored = await this.api.storage.get(scopeKey(context) + id);
      if (!stored) throw new Error('This command was removed. Refresh first.');
      const current = decodeRecord(stored, id);
      if (!sameAssociation(current.run, entry.run)) throw new Error('Launch association changed. Review it before forgetting.');
      await this.assertContext(context);
      await this.persist(context, { ...current, run: null });
    });
  }

  async remove(id, confirm) {
    return this.exclusive(id, async () => {
      const context = this.context;
      const entry = this.entries.find(item => item.id === id);
      if (!entry || !await confirm(entry)) return;
      await this.assertContext(context);
      this.epoch++;
      await this.api.storage.delete(scopeKey(context) + id);
      this.epoch++;
      this.entries = this.entries.filter(item => item.id !== id);
      this.changed();
    });
  }

  async discover({ signal } = {}) {
    const context = this.context;
    const version = this.contextVersion;
    const check = () => {
      signal?.throwIfAborted();
      if (this.disposed || version !== this.contextVersion || !sameContext(context, this.context)) throw new Error('Workspace changed. Refresh Run Deck and try again.');
    };
    // Discovery is read-only and belongs to its dialog, not the mutation lock.
    // The host cannot cancel dispatched reads; stop before issuing the next one.
    check();
    await this.assertContext(context, { signal }); check();
    const entries = await this.api.files.list('', { project: context.projectId }); check();
    if (!entries.some(file => file.name === 'package.json')) return [];
    const metadata = await this.api.files.stat('package.json', { project: context.projectId }); check();
    if (metadata.size > 256 * 1024) throw new Error('package.json exceeds the 256 KiB inspection limit.');
    const file = await this.api.files.read('package.json', { project: context.projectId }); check();
    await this.assertContext(context, { signal }); check();
    return detectScripts(file.content, entries.map(file => file.name));
  }

  dispose() {
    this.disposed = true;
    this.epoch++;
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
  }
}
