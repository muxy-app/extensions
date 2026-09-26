// Time and scheduling are injected so tests exercise the same foreground loop.
export class ForegroundChecks {
  constructor(check, changed = () => {}, clock = globalThis) {
    this.check = check; this.changed = changed; this.clock = clock;
    this.enabled = false; this.visible = true; this.held = false;
    this.pending = false; this.interrupted = false; this.timer = null; this.disposed = false;
    this.requestedDelay = null; this.job = null; this.automatic = false;
  }
  setEnabled(enabled) { this.enabled = enabled; this.interrupted = false; this.schedule(); }
  setVisible(visible) {
    if (this.visible === visible) return;
    this.visible = visible;
    // A consent sheet may take focus during an automatic request. Cancel later
    // inspection phases and pause retries when Allow was not remembered.
    if (!visible && this.pending && this.automatic) {
      this.enabled = false; this.interrupted = true;
      this.controller?.abort(new Error('Automatic inspection paused. Refresh to continue.'));
    }
    this.schedule();
  }
  setHeld(held) { if (this.held === held) return; this.held = held; this.schedule(); }
  // Host changes and post-launch checks use the same visibility/hold policy
  // as periodic checks. Multiple invalidations become one foreground check.
  invalidate(delay = 0) {
    this.requestedDelay = Math.min(this.requestedDelay ?? delay, delay);
    this.schedule();
  }
  schedule() {
    this.clock.clearTimeout(this.timer); this.timer = null;
    if (!this.disposed && !this.interrupted && (this.enabled || this.requestedDelay !== null) && this.visible && !this.held && !this.pending) {
      this.timer = this.clock.setTimeout(() => this.tick(), this.requestedDelay ?? 5000);
    }
    this.changed();
  }
  tick() {
    this.timer = null;
    if (this.disposed || this.interrupted || (!this.enabled && this.requestedDelay === null) || !this.visible || this.held || this.pending) return;
    return this.run(this.requestedDelay !== null, true);
  }
  refresh() {
    if (this.disposed) return Promise.resolve();
    // Automatic checks can use cached state and can be cancelled on focus loss.
    // A manual request must get its own full check after they finish.
    if (this.job) return this.full && !this.automatic ? this.job : this.job.then(() => this.refresh());
    this.interrupted = false;
    return this.run(true, false);
  }
  run(full, automatic) {
    this.clock.clearTimeout(this.timer); this.timer = null;
    this.requestedDelay = null;
    this.controller = automatic ? new AbortController() : null;
    const signal = this.controller?.signal;
    this.pending = true; this.full = full; this.automatic = automatic; this.changed();
    this.job = Promise.resolve().then(() => {
      signal?.throwIfAborted();
      return this.disposed ? false : this.check({ full, automatic, signal });
    }).then(result => {
      if (result === false) this.enabled = false;
      return result;
    }).catch(() => { this.enabled = false; }).finally(() => {
      this.pending = false; this.job = null; this.controller = null;
      if (!this.disposed) this.schedule();
    });
    return this.job;
  }
  dispose() { this.disposed = true; this.controller?.abort(); this.clock.clearTimeout(this.timer); }
}

export class ServiceHistory {
  constructor() { this.records = new Map(); }
  key(service, host) {
    const endpoints = service.ports.map(p => [p.port, [...(p.hosts || [])].sort()]).sort((a, b) => a[0] - b[0]);
    return JSON.stringify([host, service.source?.entryId || service.cwd, service.executable, endpoints]);
  }
  observe(service, host, now) {
    const key = this.key(service, host);
    // Parser strings may be slices/ropes backed by a full host scan. Keep a
    // serialized identity in long-lived history so it owns only this value.
    const identity = JSON.stringify(service.listeningIds);
    let record = this.records.get(key);
    if (!record || now - record.at > 15000 || now < record.at) record = { samples: [], replacements: [], identity, at: now };
    if (identity !== record.identity) {
      record.replacements.push(now); record.identity = identity; record.samples = [];
    }
    // Only the last three replacements are needed to answer the threshold.
    record.replacements = record.replacements.filter(t => now - t <= 120000).slice(-3);
    if (!record.samples.length || now - record.samples.at(-1).at >= 4000) {
      record.samples.push({ at: now, cpu: service.cpuPercent, memory: service.memoryBytes });
    }
    record.samples = record.samples.filter(s => now - s.at <= 60000).slice(-16);
    record.at = now; this.records.delete(key); this.records.set(key, record);
    while (this.records.size > 200) this.records.delete(this.records.keys().next().value);
    const alerts = [];
    // Inspection time makes the cadence longer than five seconds. Include the
    // nearest sample spanning 30 seconds instead of requiring a fixed 35s bin.
    const lastAt = record.samples.at(-1).at;
    const startIndex = record.samples.findLastIndex(s => lastAt - s.at >= 30000);
    const sustained = startIndex < 0 ? [] : record.samples.slice(startIndex);
    if (sustained.length >= 4) {
      if (sustained.every(s => s.cpu != null && s.cpu >= 80)) alerts.push('highCPU');
      const first = sustained[0].memory, last = sustained.at(-1).memory;
      if (first != null && last != null && last - first >= 100 * 1024 * 1024 && last >= first * 1.25
        && sustained.every((s, i) => s.memory != null && (!i || s.memory >= sustained[i-1].memory))) alerts.push('memoryGrowth');
    }
    if (record.replacements.length >= 3) alerts.push('restartingOften');
    return { alerts, samples: record.samples.map(s => ({ ...s })) };
  }
  forget(service, host) { this.records.delete(this.key(service, host)); }
}
