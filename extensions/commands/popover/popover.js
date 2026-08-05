import '../src/styles/global.css';
import { loadCommands, onCommandsChanged } from '../src/lib/store.js';
import { iconHTML } from '../src/lib/icons.js';

function muxy() {
  if (!window.muxy) throw new Error('window.muxy unavailable — open inside Muxy.');
  return window.muxy;
}

const FILTER_THRESHOLD = 6;
const POPOVER_MIN_WIDTH = 180;
const POPOVER_MAX_WIDTH = 280;

const listEl = document.querySelector('#list');
const emptyEl = document.querySelector('#empty');
const filterEl = document.querySelector('#filter');
const manageBtn = document.querySelector('#manage');
const launcherEl = document.querySelector('.launcher');

manageBtn.querySelector('.manage-icon').innerHTML = iconHTML('gear', 14);

const state = { all: [], filtered: [], active: 0 };

function applyFilter() {
  const q = filterEl.value.trim().toLowerCase();
  state.filtered = q
    ? state.all.filter((c) => `${c.name} ${c.command}`.toLowerCase().includes(q))
    : state.all.slice();
  state.active = state.filtered.length ? 0 : -1;
  renderList();
}

function renderList() {
  listEl.innerHTML = '';
  emptyEl.hidden = state.filtered.length > 0;
  state.filtered.forEach((cmd, i) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cmd' + (i === state.active ? ' active' : '');
    btn.title = cmd.command;
    const num = filterEl.hidden && i < 9 ? `<span class="cmd-num">${i + 1}</span>` : '';
    btn.innerHTML = `<span class="cmd-icon">${iconHTML(cmd.icon, 14)}</span>` +
      `<span class="cmd-name">${escapeHTML(cmd.name || cmd.command)}</span>` + num;
    btn.addEventListener('click', () => run(cmd));
    btn.addEventListener('mousemove', () => setActive(i));
    li.appendChild(btn);
    listEl.appendChild(li);
  });
  requestAnimationFrame(resize);
}

function setActive(i) {
  if (i === state.active) return;
  state.active = i;
  [...listEl.querySelectorAll('.cmd')].forEach((el, idx) => el.classList.toggle('active', idx === state.active));
}

function move(delta) {
  if (!state.filtered.length) return;
  const n = state.filtered.length;
  setActive((state.active + delta + n) % n);
  listEl.children[state.active]?.querySelector('.cmd')?.scrollIntoView({ block: 'nearest' });
}

function load(commands) {
  state.all = commands;
  const showFilter = commands.length >= FILTER_THRESHOLD;
  filterEl.hidden = !showFilter;
  applyFilter();
  if (showFilter) filterEl.focus();
}

async function run(cmd) {
  if (!cmd || !cmd.command) return;
  try {
    const request = { kind: 'terminal', command: cmd.command };
    if (cmd.cwd) request.directory = cmd.cwd;
    await muxy().tabs.open(request);
    muxy().popover?.close?.();
  } catch (error) {
    muxy().toast?.({ title: 'Failed to run command', body: error?.message || String(error) });
  }
}

async function openSettings() {
  try {
    await muxy().tabs.open({ kind: 'extensionWebView', extension: { id: muxy().extensionID, tabType: 'settings' } });
    muxy().popover?.close?.();
  } catch (error) {
    muxy().toast?.({ title: 'Could not open settings', body: error?.message || String(error) });
  }
}

function onKeydown(event) {
  if (event.key === 'ArrowDown') { event.preventDefault(); move(1); return; }
  if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); return; }
  if (event.key === 'Enter') { event.preventDefault(); run(state.filtered[state.active]); return; }
  if (event.key === 'Escape') { event.preventDefault(); muxy().popover?.close?.(); return; }
  if (filterEl.hidden && /^[1-9]$/.test(event.key)) {
    const idx = Number(event.key) - 1;
    if (idx < state.filtered.length) { event.preventDefault(); run(state.filtered[idx]); }
  }
}

function resize() {
  const m = muxy();
  if (!m.popover?.resize) return;
  const width = preferredWidth();
  const height = Math.ceil(launcherEl.getBoundingClientRect().height);
  m.popover.resize(width, Math.min(height, 480));
}

function preferredWidth() {
  const labels = [
    ...state.filtered.map((cmd) => cmd.name || cmd.command),
    'Manage commands',
  ];
  const widest = labels.reduce((max, label) => Math.max(max, measureText(label)), 0);
  const filterWidth = filterEl.hidden ? 0 : measureText(filterEl.placeholder || 'Search') + 60;
  const contentWidth = Math.max(widest + 76, filterWidth);
  return Math.min(Math.max(Math.ceil(contentWidth), POPOVER_MIN_WIDTH), POPOVER_MAX_WIDTH);
}

function measureText(text) {
  const canvas = measureText.canvas || (measureText.canvas = document.createElement('canvas'));
  const ctx = canvas.getContext('2d');
  if (!ctx) return String(text || '').length * 7;
  ctx.font = getComputedStyle(document.body).font;
  return ctx.measureText(String(text || '')).width;
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

filterEl.addEventListener('input', applyFilter);
document.addEventListener('keydown', onKeydown);
manageBtn.addEventListener('click', openSettings);
onCommandsChanged(load);
load(loadCommands());
