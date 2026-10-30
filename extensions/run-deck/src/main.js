import './style.css';
import { ForegroundChecks } from './observation.js';
import { ServiceMonitor } from './services.js';
import { Launchpad } from './controller.js';
import { terminalState, matchingCommand, sameContext } from './model.js';
import { dictionaries, languages, languageTags } from './i18n.js';

const root = document.querySelector('#app');
const api = window.muxy;
let language = 'en';
try { language = localStorage.getItem('run-deck-language') || language; } catch {}
if (!dictionaries[language]) language = 'en';
const t = (key, values = {}) => Object.entries(values).reduce((str, [name, value]) => str.replaceAll(`{${name}}`, value), dictionaries[language][key] || key);
let query = '';
let filter = 'all';
let sortOrder = 'project';
try { sortOrder = localStorage.getItem('run-deck-sort') || sortOrder; } catch {}
if (!['project', 'cpu', 'memory'].includes(sortOrder)) sortOrder = 'project';
let renderFrame = null;
let disposed = false;
let dialog = null;
let noticeTimer;
let lastFocusRefresh = 0;
let activeActions = 0;
const cards = new Map();
const commands = api ? new Launchpad(api, change => {
  if (change?.contextChanged) {
    if (!notice.hidden) notice.hidden = true;
    dialog?.dispatchEvent(new Event('workspacechanged'));
    live.setEnabled(false);
    monitor.invalidate();
    live.invalidate();
  }
  scheduleRender();
}) : null;
const monitor = api ? new ServiceMonitor(api, scheduleRender, { commands }) : null;
const live = new ForegroundChecks(async ({ full, automatic, signal }) => {
  if (full) await commands.refresh({ cached: automatic }).catch(() => {});
  await monitor.refresh({ quiet: !full, signal });
  return monitor.state.status === 'ready';
}, scheduleRender);
let panelVisible = api?.focused !== false;

function el(tag, className = '', text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function button(label, action, className = '') {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', () => {
    activeActions++; live.setHeld(true);
    Promise.resolve().then(action).catch(showError).finally(() => {
      activeActions--; live.setHeld(!!activeActions || !!dialog);
      lastFocusRefresh = Date.now();
      render(true);
    });
  });
  return node;
}
function text(node, value) { if (node.textContent !== value) node.textContent = value; }
function attribute(node, name, value) { if (node.getAttribute(name) !== value) node.setAttribute(name, value); }
function property(node, name, value) { if (node[name] !== value) node[name] = value; }
function refreshIcon() {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', '0 0 24 24'); node.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(node.namespaceURI, 'path');
  path.setAttribute('d', 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1');
  node.append(path); return node;
}
function scheduleRender() {
  if (disposed) return;
  live.setHeld(!!dialog || !!activeActions || !!monitor?.stopping || !!monitor?.state.checking);
  if (renderFrame !== null || document.hidden || !panelVisible) return;
  renderFrame = requestAnimationFrame(() => { renderFrame = null; render(); });
}
function announce(message, error = false) {
  notice.hidden = false;
  notice.classList.toggle('error', error);
  notice.setAttribute('role', error ? 'alert' : 'status');
  text(noticeText, message);
  clearTimeout(noticeTimer);
  if (!error) noticeTimer = setTimeout(() => { notice.hidden = true; }, 6000);
}
function showError(error) { announce(error.message || String(error), true); }
async function confirm(title, message, action) {
  return await api.dialog.confirm({ title, message, buttons: [action, t('cancel')], default: t('cancel'), cancel: t('cancel'), style: 'warning' }) === action;
}
async function refresh() {
  await live.refresh();
}
async function refreshLaunch(entry, context) {
  if (!entry?.run?.token) return;
  const current = () => !disposed && !document.hidden && sameContext(context, commands.context);
  // This is completion of the user's launch, like an explicit Refresh. Opening
  // its terminal can take focus without hiding the docked panel. Do not route
  // this check through focus-gated automatic polling or cancel it on consent.
  for (const delay of [0, 500, 1000, 2000]) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (!current()) return;
    await live.refresh();
    if (!current()) return;
    render(true);
    if (monitor.state.status !== 'ready' || monitor.state.services.some(service => service.source?.token === entry.run.token)) return;
  }
}

const shell = el('main', 'shell');
shell.setAttribute('aria-label', 'Run Deck');
const header = el('header', 'header');
const startButton = button('', openStarter, 'secondary');
const languageButton = el('select', 'language');
for (const [code, name] of Object.entries(languages)) {
  const option = el('option', '', name); option.value = code; languageButton.append(option);
}
languageButton.value = language;
languageButton.addEventListener('change', () => {
  language = languageButton.value;
  try { localStorage.setItem('run-deck-language', language); } catch {}
  render();
});
header.append(startButton, languageButton);
const sectionHead = el('div', 'section-head');
const headingGroup = el('div', 'heading-group');
const heading = el('h1');
headingGroup.append(heading);
const refreshButton = button('', refresh, 'quiet refresh');
refreshButton.append(refreshIcon());
const sectionActions = el('div', 'section-actions');
const sort = el('select', 'sort');
for (const value of ['project', 'cpu', 'memory']) {
  const option = el('option'); option.value = value; sort.append(option);
}
sort.value = sortOrder;
sort.addEventListener('change', () => {
  sortOrder = sort.value;
  try { localStorage.setItem('run-deck-sort', sortOrder); } catch {}
  render();
});
const liveButton = button('', async () => {
  if (live.enabled) { live.setEnabled(false); return; }
  await refresh();
  if (monitor.state.status === 'ready') live.setEnabled(true);
}, 'live-button');
sectionActions.append(liveButton, refreshButton);
sectionHead.append(headingGroup, sectionActions);
const search = el('input', 'search'); search.type = 'search';
const toolbar = el('div', 'toolbar');
const filters = el('div', 'filters');
const filterButtons = new Map();
for (const key of ['all', 'project', 'attention']) {
  const control = button('', () => { filter = key; render(); }, 'filter');
  filterButtons.set(key, control); filters.append(control);
}
const toolsRow = el('div', 'list-tools'); toolsRow.append(search, sort);
toolbar.append(filters, toolsRow);
const overview = el('div', 'overview');
const overviewParts = [];
for (const key of ['servicesTotal', 'cpuTotal', 'memoryTotal']) {
  const tile = el('div', 'overview-item');
  const label = el('span'); const value = el('strong');
  let number, unit;
  if (key === 'memoryTotal') {
    number = el('span'); unit = el('small', 'memory-unit');
    value.append(number, document.createTextNode(' '), unit);
  }
  tile.append(label, value); overview.append(tile); overviewParts.push({ key, label, value, number, unit });
}
const liveHint = el('p', 'live-hint');
search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); render(); });
const notice = el('div', 'notice'); notice.hidden = true;
const noticeText = el('span');
const dismiss = button('×', () => { notice.hidden = true; }, 'quiet dismiss');
notice.append(noticeText, dismiss);
const scanError = el('div', 'scan-error'); scanError.setAttribute('role', 'alert');
const errorTitle = el('strong'); const errorBody = el('p'); const staleNote = el('p', 'muted');
scanError.append(errorTitle, errorBody, staleNote);
const list = el('div', 'service-list');
const empty = el('div', 'empty');
const emptyIcon = el('span', 'empty-icon');
emptyIcon.setAttribute('aria-hidden', 'true');
const emptyTitle = el('h3'); const emptyHint = el('p', 'muted');
empty.append(emptyIcon, emptyTitle, emptyHint);
const system = el('details', 'system');
const systemSummary = el('summary');
const systemLabel = el('span', 'system-label');
const systemCount = el('span', 'system-count');
systemSummary.append(systemLabel, systemCount);
const systemList = el('div', 'service-list');
const systemEmpty = el('p', 'system-empty'); systemEmpty.hidden = true;
system.append(systemSummary, systemList, systemEmpty);
system.addEventListener('toggle', scheduleRender);
const footer = el('footer', 'panel-footer');
const footerMeta = el('div', 'footer-meta');
const freshness = el('p', 'freshness'); const scopeHint = el('p', 'scope-hint');
const readings = el('div', 'readings');
readings.id = 'reading-notes'; readings.hidden = true;
readings.setAttribute('role', 'region'); readings.setAttribute('aria-labelledby', 'reading-notes-toggle');
const readingsToggle = button('', () => {
  readings.hidden = !readings.hidden;
  readingsToggle.setAttribute('aria-expanded', String(!readings.hidden));
}, 'quiet readings-toggle');
readingsToggle.id = 'reading-notes-toggle';
readingsToggle.setAttribute('aria-controls', readings.id);
readingsToggle.setAttribute('aria-expanded', 'false');
const readingsScope = el('p'); const readingsResources = el('p'); const readingsLimits = el('p');
readings.append(readingsScope, readingsResources, readingsLimits);
footerMeta.append(freshness, readingsToggle);
footer.append(system, footerMeta, scopeHint, readings);
shell.append(header, overview, notice, sectionHead, liveHint, toolbar, scanError, list, empty, footer);
root.append(shell);

function serviceName(service) {
  if (service.label) return service.label;
  const runtime = /^(node|bun|deno|python[\d.]*|ruby|java|php)$/i.test(service.name);
  if (runtime && service.cwd) {
    if (service.cwd === monitor.state.context?.path) return monitor.state.context.name;
    return service.cwd.split('/').filter(Boolean).at(-1) || service.name;
  }
  return service.name || service.executable?.split('/').at(-1) || `PID ${service.pid}`;
}
function memoryLabel(bytes) {
  if (bytes == null) return '—';
  if (bytes === 0) return '0 MB';
  if (bytes < 1e6) return '<1 MB';
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}
function uptimeLabel(seconds) {
  if (seconds == null) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m` : `${seconds}s`;
}
function makeCard(id) {
  const card = el('article', 'service'); card.dataset.id = id;
  const row = el('div', 'service-row');
  const statusDot = el('span', 'status-dot'); statusDot.setAttribute('aria-hidden', 'true');
  const info = el('div', 'service-info');
  const nameRow = el('div', 'service-name');
  const name = el('h3'); const projectTag = el('span', 'project-tag');
  nameRow.append(statusDot, name, projectTag);
  const address = el('p', 'service-address');
  const resources = el('p', 'service-resources');
  const cpu = el('span', 'resource'); const memory = el('span', 'resource');
  resources.append(cpu, memory);
  const source = el('p', 'service-source');
  const alerts = el('div', 'service-alerts');
  const trend = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  trend.setAttribute('viewBox', '0 0 96 24'); trend.setAttribute('aria-hidden', 'true'); trend.classList.add('sparkline');
  const line = document.createElementNS(trend.namespaceURI, 'polyline'); trend.append(line);
  resources.append(trend);
  info.append(nameRow, address, source, alerts, resources);
  const actions = el('div', 'service-actions');
  const open = button('', () => monitor.open(id, { confirmHost: hostname => confirm(t('hostTitle'), t('hostText', { name: hostname }), t('hostAccept')) }), 'open');
  const stop = button('', async () => {
    const result = await monitor.stop(id, confirmOutside);
    if (result?.outcome) announce(t(result.outcome), result.outcome !== 'stopped');
  }, 'quiet stop');
  const terminal = button('', () => monitor.terminal(id), 'quiet terminal');
  const restart = button('', async () => {
    const result = await monitor.restart(id, confirmOutside);
    if (result?.outcome) {
      announce(t(result.outcome));
      await refreshLaunch(commands.entries.find(entry => entry.id === result.entryId), commands.context);
    }
  }, 'quiet restart');
  actions.append(open, terminal, restart, stop);
  row.append(info, actions);
  const detail = el('details', 'service-details');
  const summary = el('summary', '', '···');
  detail.append(summary);
  card.append(row, detail);
  card.parts = { name, projectTag, address, source, alerts, trend, line, terminal, restart, cpu, memory, open, stop, summary, detail };
  detail.addEventListener('toggle', () => {
    if (detail.open && card.service) updateDetails(card);
    else if (card.details) { card.details.body.remove(); card.details = null; }
  });
  return card;
}

// Detail DOM exists only while expanded. Rows and metadata cells survive
// metric updates, so a new snapshot changes text without replacing nodes.
function makeDetails(card) {
  const id = card.dataset.id;
  const { detail, open } = card.parts;
  const detailBody = el('div', 'detail-body');
  const metadata = el('dl');
  const metadataCells = ['source', 'command', 'uptime', 'directory', 'ports'].map(key => {
    const label = el('dt'); const value = el('dd', 'mono');
    metadata.append(label, value); return { key, label, value };
  });
  const processTree = el('div', 'process-tree');
  const treeTable = el('table'); const treeTitle = el('caption');
  const treeHead = el('thead'); const treeHeaders = el('tr');
  const treeColumns = ['process', 'pid', 'cpu', 'memory'].map(key => {
    const cell = el('th'); cell.scope = 'col'; treeHeaders.append(cell); return { key, cell };
  });
  treeHead.append(treeHeaders); const treeList = el('tbody');
  treeTable.append(treeTitle, treeHead, treeList); processTree.append(treeTable);
  const restriction = el('p', 'muted');
  const urlOptions = el('details', 'url-options'); const urlSummary = el('summary');
  const urlForm = el('form', 'url-form');
  const url = el('input'); url.type = 'url'; url.required = true; url.maxLength = 4096;
  const urlField = field('', url);
  const urlHint = el('p', 'muted small');
  const openCustom = el('button', '', ''); openCustom.type = 'submit';
  urlForm.append(urlField, urlHint, openCustom);
  urlForm.addEventListener('submit', async event => {
    event.preventDefault();
    activeActions++; live.setHeld(true);
    openCustom.disabled = true;
    try { await monitor.open(id, { url: url.value }); detail.open = false; open.focus({ preventScroll: true }); }
    catch (error) { showError(error); }
    finally { openCustom.disabled = false; activeActions--; live.setHeld(!!activeActions || !!dialog); lastFocusRefresh = Date.now(); }
  });
  urlOptions.append(urlSummary, urlForm);
  detailBody.append(metadata, processTree, restriction, urlOptions); detail.append(detailBody);
  return { body: detailBody, metadataCells, treeTitle, treeColumns, treeList, rows: new Map(), restriction, url, urlSummary, urlField, urlHint, openCustom };
}

function updateDetails(card) {
  if (!card.parts.detail.open || card.hidden || (card.service.restriction === 'protected' && !system.open)) return;
  const service = card.service;
  const p = card.details ||= makeDetails(card);
  property(p.openCustom, 'disabled', monitor.state.busy.has(service.id) || monitor.state.status !== 'ready');
  if (p.service === service && p.language === language) return;
  if (!p.service) p.url.value = service.url || `http://localhost:${service.ports[0].port}`;
  text(p.treeTitle, t('processTree', { count: service.members.length }));
  for (const { key, cell } of p.treeColumns) text(cell, t(key));
  const ids = new Set(service.members.map(member => member.id));
  for (const [id, row] of p.rows) if (!ids.has(id)) { row.remove(); p.rows.delete(id); }
  for (const [index, member] of service.members.entries()) {
    let row = p.rows.get(member.id);
    if (!row) {
      row = el('tr');
      row.append(el('td', 'process-name'), el('td', 'mono muted'), el('td', 'mono'), el('td', 'mono'));
      p.rows.set(member.id, row);
    }
    if (p.treeList.children[index] !== row) p.treeList.insertBefore(row, p.treeList.children[index] || null);
    const depth = String(Math.min(member.depth, 5));
    if (row.style.getPropertyValue('--depth') !== depth) row.style.setProperty('--depth', depth);
    const values = [`${member.depth ? '↳ ' : ''}${member.name || member.executable?.split('/').at(-1) || 'Process'}`,
      String(member.pid), member.cpuPercent == null ? '—' : `${member.cpuPercent.toFixed(1)}%`, memoryLabel(member.memoryBytes)];
    values.forEach((value, i) => text(row.children[i], value));
  }
  const values = [service.source?.entryId ? 'Run Deck' : service.source?.name || t('unknownSource'),
    service.source?.command || t('unknownCommand'), uptimeLabel(service.uptimeSeconds), service.cwd || '—',
    service.ports.map(item => item.hosts.map(host => `${host}:${item.port}`).join(', ')).join(', ')];
  p.metadataCells.forEach(({ key, label, value }, i) => { text(label, t(key)); text(value, values[i]); });
  text(p.restriction, service.restriction ? t(service.restriction) : ''); property(p.restriction, 'hidden', !service.restriction);
  text(p.urlField.firstChild, t('customURL')); text(p.urlSummary, t('customAddress'));
  text(p.urlHint, t('urlHint')); text(p.openCustom, t('openCustom'));
  p.service = service; p.language = language;
}
function confirmOutside(service) {
  return confirm(t('stopTitle', { name: serviceName(service) }), t('stopText', { pid: service.pid, count: service.members.length, ports: service.ports.map(p => p.port).join(', ') }), t('stop'));
}
function renderCards(services) {
  const normal = services.filter(service => service.restriction !== 'protected');
  const topCPU = normal.length > 1 ? Math.max(0, ...normal.map(service => service.cpuPercent ?? 0)) : 0;
  const topMemory = normal.length > 1 ? Math.max(0, ...normal.map(service => service.memoryBytes ?? 0)) : 0;
  const ids = new Set(services.map(service => service.id));
  let recoverFocus = false;
  const positions = new Map();
  for (const [id, card] of cards) if (!ids.has(id)) {
    recoverFocus ||= card.contains(document.activeElement);
    card.remove(); cards.delete(id);
  }
  for (const service of services) {
    let card = cards.get(service.id);
    if (!card) { card = makeCard(service.id); cards.set(service.id, card); }
    const target = service.restriction === 'protected' ? systemList : list;
    // Keep keyed rows and their disclosures; move only when the order changes.
    const position = positions.get(target) || 0;
    if (target.children[position] !== card) {
      const focused = card.contains(document.activeElement) ? document.activeElement : null;
      target.insertBefore(card, target.children[position] || null);
      focused?.focus({ preventScroll: true });
    }
    positions.set(target, position + 1);
    const p = card.parts;
    const busy = monitor.state.busy.has(service.id);
    const stale = monitor.state.status !== 'ready';
    const terminalAvailable = !!service.source?.tabId && commands.tabs.some(tab => tab.id === service.source.tabId && tab.kind === 'terminal');
    const viewKey = [language, stale, busy, monitor.stopping, topCPU, topMemory, service.url, terminalAvailable].join('|');
    // Service tabs do not filter the separate app/system section. Search covers both.
    const matchesFilter = service.restriction === 'protected' || filter === 'all' || filter === 'project' && service.inProject || filter === 'attention' && service.alerts?.length;
    const matches = !query || `${serviceName(service)} ${service.name} ${service.cwd} ${service.ports.map(item => `:${item.port}`).join(', ')}`.toLowerCase().includes(query);
    property(card, 'hidden', !matches || !matchesFilter);
    property(p.projectTag, 'hidden', !service.inProject || filter === 'project' && service.restriction !== 'protected');
    const unchanged = card.service === service && card.viewKey === viewKey;
    card.service = service; card.viewKey = viewKey;
    updateDetails(card);
    if (unchanged) continue;
    attribute(card, 'data-stale', String(stale));
    text(p.name, serviceName(service));
    text(p.projectTag, t('currentProject'));
    const portLabel = service.ports.map(item => `:${item.port}`).join(', ');
    text(p.address, service.name === serviceName(service) ? portLabel : `${service.name} · ${portLabel}`);
    const cpuLabel = service.cpuPercent == null ? '—' : `${service.cpuPercent.toFixed(1)}%`;
    const memory = memoryLabel(service.memoryBytes);
    const highestCPU = !stale && service.restriction !== 'protected' && topCPU > 0 && service.cpuPercent === topCPU;
    const highestMemory = !stale && service.restriction !== 'protected' && topMemory > 0 && service.memoryBytes === topMemory;
    text(p.cpu, `${t('cpu')} ${cpuLabel}`);
    text(p.memory, `${t('memory')} ${memory}`);
    p.cpu.classList.toggle('highest', highestCPU); p.memory.classList.toggle('highest', highestMemory);
    attribute(p.cpu, 'title', `${highestCPU ? t('topCPU') + ' · ' : ''}${t('cpuHint')}`);
    attribute(p.memory, 'title', `${highestMemory ? t('topMemory') + ' · ' : ''}${t('memoryHint')}`);
    attribute(p.cpu, 'aria-label', `${t(highestCPU ? 'topCPU' : 'cpu')} ${cpuLabel}`);
    attribute(p.memory, 'aria-label', `${t(highestMemory ? 'topMemory' : 'memory')} ${memory}`);
    const sourceName = service.source?.entryId ? 'Run Deck' : service.source?.name;
    const processCount = `${service.members.length} ${t(service.members.length === 1 ? 'oneProcess' : 'manyProcesses')}`;
    text(p.source, [sourceName, service.members.length > 1 ? processCount : null].filter(Boolean).join(' · '));
    property(p.source, 'hidden', !sourceName && service.members.length === 1);
    const alertKey = language + (service.alerts || []).join('|');
    if (p.alertKey !== alertKey) {
      p.alerts.replaceChildren();
      for (const key of service.alerts || []) { const badge = el('span', 'alert-badge', t(key)); badge.title = t(`${key}Hint`); p.alerts.append(badge); }
      p.alertKey = alertKey;
    }
    property(p.alerts, 'hidden', !service.alerts?.length || stale);
    card.classList.toggle('needs-attention', !!service.alerts?.length && !stale);
    const samples = service.samples || [];
    // Reserve the trend slot while history warms up or resets; metrics must not move actions.
    const hideTrend = samples.length < 2 || samples.some(s => s.cpu == null);
    p.trend.classList.toggle('warming-up', hideTrend);
    const maximum = Math.max(100, ...samples.map(s => s.cpu || 0));
    attribute(p.line, 'points', samples.map((s,i) => `${i * 96 / Math.max(1,samples.length-1)},${22 - (s.cpu || 0) / maximum * 20}`).join(' '));
    text(p.terminal, t('terminalShort')); property(p.terminal, 'hidden', !terminalAvailable);
    attribute(p.terminal, 'aria-label', `${t('terminalShort')} ${serviceName(service)}`);
    text(p.restart, t('restart')); property(p.restart, 'hidden', !service.source?.entryId || !!service.restriction);
    attribute(p.restart, 'aria-label', `${t('restart')} ${serviceName(service)}`);
    property(p.restart, 'disabled', busy || stale || monitor.stopping);
    property(p.terminal, 'disabled', busy || stale);

    text(p.open, t('open')); property(p.open, 'hidden', !service.url || service.restriction === 'protected');
    attribute(p.open, 'aria-label', `${t('open')} ${serviceName(service)}`);
    attribute(p.open, 'title', service.url || '');
    text(p.stop, busy && monitor.stopping ? t('stopping') : t('stop'));
    attribute(p.stop, 'aria-label', `${t('stop')} ${serviceName(service)}`);
    const rootName = service.executable?.split('/').at(-1) || service.name;
    attribute(p.stop, 'title', `${t('stop')} ${rootName} · PID ${service.pid} · ${portLabel}`);
    property(p.stop, 'hidden', !!service.restriction);
    property(p.open, 'disabled', busy || stale); property(p.stop, 'disabled', busy || stale || monitor.stopping);
    attribute(p.summary, 'aria-label', `${t('details')}: ${serviceName(service)}`);
    attribute(p.summary, 'title', t('details'));
  }
  if (recoverFocus) { heading.tabIndex = -1; heading.focus(); }
}
function render(afterAction = false) {
  if (disposed || document.hidden || (!panelVisible && !afterAction)) return;
  const state = monitor?.state;
  const services = [...(state?.services || [])];
  const sortField = sortOrder === 'cpu' ? 'cpuPercent' : sortOrder === 'memory' ? 'memoryBytes' : null;
  if (sortField) services.sort((a, b) => (b[sortField] ?? -1) - (a[sortField] ?? -1));
  const normal = services.filter(service => service.restriction !== 'protected');
  const protectedCount = services.length - normal.length;
  document.documentElement.lang = languageTags[language];
  text(startButton, t('startCommand'));
  attribute(languageButton, 'aria-label', t('language'));
  attribute(languageButton, 'title', t('language'));
  languageButton.disabled = !!dialog;
  startButton.disabled = !api || !!dialog;
  text(heading, t('running'));
  const sum = key => normal.some(s => s[key] == null) ? null : normal.reduce((value,s) => value + s[key], 0);
  const totalCPU = sum('cpuPercent'); const totalMemory = sum('memoryBytes');
  const values = [String(normal.length), totalCPU == null ? '—' : `${totalCPU.toFixed(1)}%`, totalMemory == null ? '—' : `≈ ${memoryLabel(totalMemory)}`];
  for (const [i, part] of overviewParts.entries()) {
    text(part.label, t(part.key));
    const value = state?.checkedAt ? values[i] : '—';
    if (part.unit) {
      const match = value.match(/^(.*) (MB|GB)$/);
      text(part.number, match ? match[1] : value);
      text(part.unit, match ? match[2] : '');
      property(part.unit, 'hidden', !match);
    } else text(part.value, value);
  }
  overview.classList.toggle('is-stale', state?.status !== 'ready');
  const attention = normal.filter(s => s.alerts?.length).length;
  for (const [key,control] of filterButtons) {
    text(control, t(`filter_${key}`) + (key === 'attention' && attention ? ` ${attention}` : ''));
    control.setAttribute('aria-pressed', String(filter === key));
  }
  const liveKey = live.enabled ? !live.visible ? 'liveHidden' : 'liveOn' : live.interrupted ? 'livePaused' : 'liveOff';
  text(liveButton, t(liveKey)); liveButton.classList.toggle('is-live', live.enabled);
  liveButton.setAttribute('aria-pressed', String(live.enabled));
  liveButton.title = t(live.enabled ? 'livePauseHint' : 'liveEnableHint');
  liveButton.disabled = !api || !!dialog || !!monitor?.stopping;
  text(liveHint, t('liveInterrupted'));
  liveHint.hidden = !live.interrupted || !api;

  attribute(refreshButton, 'aria-label', t(state?.checking ? 'refreshing' : 'refresh'));
  attribute(refreshButton, 'title', t(state?.checking ? 'refreshing' : 'refresh'));
  attribute(refreshButton, 'aria-busy', String(!!state?.checking));
  refreshButton.disabled = !api || state?.status === 'loading' || monitor?.stopping;
  sort.setAttribute('aria-label', t('sort'));
  sort.title = t('sort'); sort.hidden = services.length < 2;
  for (const option of sort.options) text(option, t(`sort_${option.value}`));
  search.placeholder = t('search'); search.setAttribute('aria-label', t('search')); search.hidden = false;
  dismiss.setAttribute('aria-label', t('dismiss'));
  scanError.hidden = state?.status !== 'error';
  text(errorTitle, t('failed')); text(errorBody, state?.error || ''); text(staleNote, t('stale')); staleNote.hidden = !state?.checkedAt;
  renderCards(services);
  const shownNormal = [...list.children].some(card => !card.hidden);
  empty.hidden = shownNormal || state?.status === 'error';
  text(emptyTitle, t(!api ? 'noHost' : state?.status === 'loading' && !services.length ? 'checking' : query || filter !== 'all' ? 'noMatches' : 'noServices'));
  text(emptyHint, t(!api ? 'noHostHint' : 'noServicesHint'));
  emptyHint.hidden = state?.status === 'loading' || !!query || filter !== 'all';
  system.hidden = protectedCount === 0;
  const matchingSystemCount = [...systemList.children].filter(card => !card.hidden).length;
  text(systemLabel, t('system')); text(systemCount, query ? `${matchingSystemCount}/${protectedCount}` : String(protectedCount));
  text(systemEmpty, t('noSystemMatches')); systemEmpty.hidden = matchingSystemCount > 0;
  if (query && matchingSystemCount) system.open = true;
  freshness.hidden = !state?.checkedAt;
  text(freshness, state?.checkedAt ? t('checked', { time: state.checkedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) }) : '');
  text(scopeHint, t('limited')); scopeHint.hidden = !state?.limited;
  text(readingsToggle, t('aboutReadings')); text(readingsScope, t('totalsHint'));
  text(readingsResources, t('resourceHint')); text(readingsLimits, t('tcpOnly'));
}

function field(label, control) {
  const wrapper = el('label', 'field'); wrapper.append(el('span', '', label), control); return wrapper;
}
function openStarter() {
  if (dialog) return;
  dialog = el('dialog', 'starter');
  const activeDialog = dialog;
  const discovery = new AbortController();
  let context, candidates = [], starting = false, scopeLost = false;
  const current = () => !disposed && !scopeLost && dialog === activeDialog && activeDialog.open;
  const heading = el('h2', '', t('newTitle')); heading.id = 'starter-title'; heading.tabIndex = -1;
  activeDialog.setAttribute('aria-labelledby', heading.id);
  const scope = el('div', 'starter-scope');
  const project = el('strong'); const path = el('code', 'muted'); scope.append(project, path);
  const location = el('details', 'options starter-location'); location.hidden = true;
  location.append(el('summary', '', t('workingDirectory')), scope);
  const loading = el('p', 'discovery-status small muted', t('scriptsLoading')); loading.setAttribute('role', 'status');
  const retry = button(t('retryScripts'), () => { void discover(); }); retry.hidden = true;
  const projects = el('section', 'command-section project-commands');
  const projectHeading = el('h3', '', t('projectCommands')); const projectList = el('div', 'command-list');
  projects.append(projectHeading, projectList); projects.hidden = true;
  const saved = el('section', 'command-section saved');
  const savedList = el('div', 'command-list'); saved.append(el('h3', '', t('savedCommands')), savedList); saved.hidden = true;
  const scripts = el('details', 'options other-scripts');
  const scriptsSummary = el('summary'); const choices = el('div', 'command-list'); scripts.append(scriptsSummary, choices); scripts.hidden = true;
  const custom = el('details', 'options custom-command'); custom.append(el('summary', '', t('customCommand')));
  const form = el('form');
  const fields = el('fieldset'); fields.disabled = true;
  const command = el('textarea', 'mono'); command.rows = 2; command.required = true; command.maxLength = 4096; command.placeholder = 'npm run dev';
  command.spellcheck = false; command.setAttribute('autocorrect', 'off'); command.setAttribute('autocapitalize', 'off');
  const name = el('input'); name.maxLength = 80; name.placeholder = t('optional');
  const directory = el('input', 'mono'); directory.value = '.'; directory.maxLength = 1024;
  directory.spellcheck = false; directory.setAttribute('autocorrect', 'off'); directory.setAttribute('autocapitalize', 'off');
  const advanced = el('details', 'options'); advanced.append(el('summary', '', t('advanced')));
  advanced.append(field(t('name'), name), field(t('directory'), directory), el('p', 'small muted', t('directoryHint')), el('p', 'small muted', t('shellHint')));
  const submit = el('button', 'primary', t('launchCustom')); submit.type = 'submit'; submit.disabled = true;
  fields.append(field(t('command'), command), advanced, submit); form.append(fields); custom.append(form);
  const formError = el('p', 'error'); formError.hidden = true; formError.tabIndex = -1; formError.setAttribute('role', 'alert');
  const actions = el('header', 'starter-header');
  const close = button(t('close'), () => { if (!starting) activeDialog.close(); }, 'quiet starter-close'); actions.append(heading, close);
  activeDialog.append(actions, loading, retry, projects, saved, scripts, custom, location, formError);
  root.append(activeDialog);
  activeDialog.addEventListener('cancel', event => { if (starting) event.preventDefault(); else discovery.abort(); });
  activeDialog.addEventListener('click', event => {
    if (starting && event.target.closest('summary')) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  activeDialog.addEventListener('workspacechanged', () => {
    scopeLost = true; context = null; discovery.abort();
    loading.hidden = true; retry.hidden = true;
    text(formError, t('starterWorkspaceChanged')); formError.hidden = false; setBusy(starting);
  });
  activeDialog.addEventListener('close', () => {
    discovery.abort(); activeDialog.remove();
    if (dialog === activeDialog) dialog = null;
    live.setHeld(!!activeActions); render(true); startButton.focus();
  });
  activeDialog.showModal(); heading.focus(); live.setHeld(true); render();

  function setBusy(value) {
    starting = value;
    activeDialog.setAttribute('aria-busy', String(value));
    for (const control of activeDialog.querySelectorAll('button')) control.disabled = value || !context || scopeLost || control.dataset.blocked === 'true';
    fields.disabled = value || !context || scopeLost;
    close.disabled = value;
  }
  async function act(action, trigger) {
    if (starting || !current() || !context) return;
    setBusy(true); formError.hidden = true;
    const label = trigger?.textContent;
    if (trigger) text(trigger, t('working'));
    try {
      await commands.assertContext(context);
      await action();
    } catch (error) {
      if (dialog !== activeDialog || !activeDialog.open) return;
      text(formError, scopeLost ? t('starterWorkspaceChanged') : error.message); formError.hidden = false;
      if (sameContext(context, commands.context)) renderChoices();
      formError.focus();
    } finally {
      if (trigger) text(trigger, label);
      setBusy(false); lastFocusRefresh = Date.now();
    }
  }
  async function start(input) {
    const result = await commands.start(input, context);
    if (!result) return;
    activeDialog.close();
    if (result.action === 'launch') {
      announce(t('launched'));
      await refreshLaunch(result.entry, context);
    }
  }
  function commandRow(input, entry, primary = false) {
    const row = el('div', 'command-row');
    const copy = el('div', 'command-copy');
    const title = el('div', 'command-title'); title.append(el('strong', '', input.name));
    const state = entry ? terminalState(entry, commands.tabs) : 'ready';
    if (entry?.run && state !== 'open') title.append(el('span', 'command-tag', t('reviewTerminal')));
    copy.append(title);
    if (input.detail) {
      const script = el('details', 'command-script');
      const summary = el('summary'); summary.append(el('code', '', input.command));
      summary.setAttribute('aria-label', t('scriptDetails', { name: input.name, command: input.command }));
      script.append(summary, el('p', 'script-detail muted', input.detail)); copy.append(script);
    } else copy.append(el('code', 'command-line', input.command));
    if (input.directory && input.directory !== '.') copy.append(el('p', 'command-directory muted', `${t('directory')}: ${input.directory}`));
    const action = button(t(state === 'open' ? 'terminalShort' : input.kind === 'task' ? 'runTask' : 'launch'), () => act(() => start(input), action), primary && state === 'ready' ? 'primary' : '');
    action.setAttribute('aria-label', `${action.textContent} ${input.name}`);
    if (entry?.run && state !== 'open') { action.dataset.blocked = 'true'; action.disabled = true; }
    const controls = el('div', 'command-actions'); controls.append(action);
    if (entry) {
      const menu = el('details', 'saved-menu'); const summary = el('summary', '', '···');
      summary.setAttribute('aria-label', t('commandActions', { name: input.name })); menu.append(summary);
      const body = el('div', 'menu');
      if (entry.run) body.append(button(t('forget'), () => act(async () => {
        await commands.forget(entry.id, () => confirm(t('forgetTitle'), t('forgetText'), t('forget'))); renderChoices();
      })));
      body.append(button(t('remove'), () => act(async () => {
        await commands.remove(entry.id, () => confirm(t('removeTitle'), t('removeText'), t('remove'))); renderChoices();
      })));
      menu.append(body); controls.append(menu);
    }
    row.append(copy, controls);
    if (entry?.run && state !== 'open') row.append(el('p', 'small muted command-review', t('needsReview')));
    return row;
  }
  function renderChoices() {
    projectList.replaceChildren(); savedList.replaceChildren(); choices.replaceChildren();
    const matched = new Set();
    for (const candidate of candidates) {
      const entry = matchingCommand(commands.entries, candidate);
      if (entry) matched.add(entry.id);
      const target = candidate.kind === 'service' ? projectList : choices;
      target.append(commandRow(candidate, entry, candidate.kind === 'service' && !projectList.children.length));
    }
    for (const entry of commands.entries) if (!matched.has(entry.id)) savedList.append(commandRow(entry, entry));
    projects.hidden = !projectList.children.length; saved.hidden = !savedList.children.length;
    scripts.hidden = !choices.children.length;
    text(scriptsSummary, t('otherScripts', { count: choices.children.length }));
    setBusy(starting);
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    void act(() => start({ name: name.value.trim() || command.value.trim().slice(0, 80), command: command.value, directory: directory.value, kind: 'service' }), submit);
  });
  // Discovery never owns a mutation lock or blocks custom commands after context loads.
  async function discover() {
    retry.hidden = true; loading.hidden = false; text(loading, t('scriptsLoading'));
    try {
      candidates = await commands.discover({ signal: discovery.signal });
      if (!current()) return;
      renderChoices(); loading.hidden = !!candidates.length;
      text(loading, t('scriptsUnavailable'));
      if (!candidates.length) custom.open = true;
    } catch (error) {
      if (!current()) return;
      text(loading, `${t('scriptsFailed')} ${error.message}`); retry.hidden = false; custom.open = true;
    }
  }
  async function load() {
    try {
      await commands.refresh();
      if (!current()) return;
      context = { ...commands.context };
      text(project, `${context.name}${context.branch ? ` · ${context.branch}` : ''}`); text(path, context.path);
      location.hidden = false;
      renderChoices();
      await discover();
    } catch (error) {
      if (!current()) return;
      loading.hidden = true; text(formError, error.message); formError.hidden = false;
    }
  }
  void load();
}

render();
if (api) {
  commands.subscribe();
  const focusRefresh = () => {
    if (document.hidden || dialog || activeActions || live.interrupted || live.pending || monitor.state.checking || monitor.state.status === 'error' || Date.now() - lastFocusRefresh < 3000) return;
    lastFocusRefresh = Date.now();
    // Let the click that focused the panel complete before a consent prompt or
    // disabled loading state can replace its target.
    live.invalidate(150);
  };
  const visibility = () => {
    const visible = !document.hidden && panelVisible;
    commands.setVisible(visible);
    live.setVisible(visible);
    if (visible) scheduleRender();
    else { cancelAnimationFrame(renderFrame); renderFrame = null; }
  };
  const unsubscribeFocus = api.onFocus?.(focused => { panelVisible = focused; visibility(); if (focused && !live.enabled) focusRefresh(); });
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('blur', () => { panelVisible = false; visibility(); });
  window.addEventListener('focus', () => { panelVisible = true; visibility(); });
  window.addEventListener('pagehide', () => {
    disposed = true;
    clearTimeout(noticeTimer); cancelAnimationFrame(renderFrame);
    unsubscribeFocus?.();
    live.dispose(); monitor.dispose(); commands.dispose();
  }, { once: true });
  visibility();
  live.setEnabled(true);
  live.invalidate();
}
