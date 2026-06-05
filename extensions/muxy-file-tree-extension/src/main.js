import './styles.css';

const ROOT = '';
const MAX_AUTO_REFRESH_DELAY = 200;
const EXPANDED_STORAGE_PREFIX = 'muxy-file-tree:expanded:';
const state = {
  expanded: new Set([ROOT]),
  entries: new Map(),
  filter: '',
  loading: new Set(),
  activeRoot: null,
  activeName: '',
  activePath: null,
  menuPath: null,
  visibleRows: [],
  refreshTimer: null,
};

const treeEl = document.querySelector('#tree');
const statusEl = document.querySelector('#status');
const filterEl = document.querySelector('#filter');
const menuEl = document.querySelector('#menu');

function muxy() {
  if (!window.muxy) {
    throw new Error('window.muxy is not available. Open this panel inside Muxy.');
  }
  return window.muxy;
}

function normalizePath(path) {
  if (!path || path === '.') return ROOT;
  return String(path).replace(/^\.?\//, '').replace(/\/+$/, '');
}

function childPath(parent, name) {
  return parent ? `${parent}/${name}` : name;
}

function displayPath(path) {
  return path || '.';
}

function fileTypeMeta(entry) {
  if (entry.isDirectory) {
    return { className: 'folder', label: '' };
  }

  const name = entry.name.toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop() : '';
  const namedTypes = {
    '.env': ['env', 'ENV'],
    '.gitignore': ['git', 'GIT'],
    dockerfile: ['docker', 'DOC'],
    makefile: ['make', 'MK'],
    readme: ['md', 'MD'],
  };
  const extensionTypes = {
    c: ['code', 'C'],
    cc: ['code', 'C++'],
    cpp: ['code', 'C++'],
    css: ['css', 'CSS'],
    csv: ['csv', 'CSV'],
    doc: ['doc', 'DOC'],
    docx: ['doc', 'DOC'],
    go: ['go', 'GO'],
    html: ['html', 'HTM'],
    java: ['java', 'JAV'],
    jpeg: ['image', 'IMG'],
    jpg: ['image', 'IMG'],
    js: ['js', 'JS'],
    json: ['json', '{}'],
    jsx: ['js', 'JSX'],
    log: ['text', 'LOG'],
    md: ['md', 'MD'],
    pdf: ['pdf', 'PDF'],
    png: ['image', 'IMG'],
    py: ['py', 'PY'],
    rb: ['code', 'RB'],
    rs: ['code', 'RS'],
    sh: ['shell', 'SH'],
    swift: ['swift', 'SW'],
    toml: ['config', 'TOM'],
    ts: ['ts', 'TS'],
    tsx: ['ts', 'TSX'],
    txt: ['text', 'TXT'],
    xls: ['sheet', 'XLS'],
    xlsx: ['sheet', 'XLS'],
    yaml: ['config', 'YML'],
    yml: ['config', 'YML'],
    zip: ['archive', 'ZIP'],
  };

  const [type, label] = namedTypes[name] || extensionTypes[ext] || ['file', ''];
  return { className: `file file-${type}`, label };
}

function fileIconMarkup(entry) {
  if (entry.isDirectory) {
    return `
      <span class="file-icon folder" aria-hidden="true">
        <svg viewBox="0 0 20 16" focusable="false">
          <path d="M2.5 4.5h5l1.5 2h8.5v6.25c0 .97-.78 1.75-1.75 1.75H4.25c-.97 0-1.75-.78-1.75-1.75V4.5Z"></path>
          <path d="M2.5 6.5h15"></path>
        </svg>
      </span>
    `;
  }
  const icon = fileTypeMeta(entry);
  return `<span class="file-icon ${icon.className}" aria-hidden="true">${escapeHtml(icon.label)}</span>`;
}

function activeStorageKey() {
  const root = state.activeRoot || state.activeName || 'default';
  return `${EXPANDED_STORAGE_PREFIX}${encodeURIComponent(root)}`;
}

function loadExpandedState() {
  try {
    const raw = window.localStorage.getItem(activeStorageKey());
    const paths = raw ? JSON.parse(raw) : [];
    state.expanded = new Set([ROOT]);
    if (Array.isArray(paths)) {
      paths.map(normalizePath).filter(Boolean).forEach((path) => state.expanded.add(path));
    }
  } catch (error) {
    console.warn('Failed to load expanded file tree state', error);
    state.expanded = new Set([ROOT]);
  }
}

function saveExpandedState() {
  try {
    const paths = [...state.expanded].filter(Boolean).sort();
    window.localStorage.setItem(activeStorageKey(), JSON.stringify(paths));
  } catch (error) {
    console.warn('Failed to save expanded file tree state', error);
  }
}

function isKnownDirectory(path) {
  const normalized = normalizePath(path);
  if (normalized === ROOT) return true;
  const parts = normalized.split('/');
  const parent = parts.slice(0, -1).join('/');
  const entries = state.entries.get(parent) || [];
  return entries.some((entry) => entry.path === normalized && entry.isDirectory);
}

function resolveEditorFilePath(path) {
  const rawPath = String(path || '');
  if (!rawPath || rawPath === ROOT) {
    throw new Error('Cannot open the workspace root as a file.');
  }
  if (rawPath.startsWith('/')) return rawPath;
  if (!state.activeRoot) {
    throw new Error('Active worktree root is unavailable.');
  }
  return `${state.activeRoot.replace(/\/+$/, '')}/${normalizePath(rawPath)}`;
}

function fallbackCopyText(text) {
  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.append(input);
  input.select();
  document.execCommand('copy');
  input.remove();
}

async function copyText(text, label = 'Copied') {
  try {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        fallbackCopyText(text);
      }
    } else {
      fallbackCopyText(text);
    }
    setTransientStatus(label);
  } catch (error) {
    console.error('Failed to copy text', error);
    setStatus(`Could not copy: ${error?.message || error}`, 'error');
  }
}

async function copyActiveRelativePath() {
  const entry = activeEntry();
  if (!entry) {
    setStatus('No file selected', 'muted');
    return;
  }
  await copyRelativePath(entry.path);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function updateContext() {
  document.title = state.activeName || 'Muxy File Tree';
}

function setStatus(message, kind = 'muted') {
  statusEl.textContent = message || '';
  statusEl.dataset.kind = kind;
  statusEl.hidden = !message;
}

function setTransientStatus(message, kind = 'muted', delay = 1600) {
  setStatus(message, kind);
  window.setTimeout(() => {
    if (statusEl.textContent === message) setStatus('');
  }, delay);
}

function activeEntry() {
  return state.visibleRows.find((item) => item.path === state.activePath) || null;
}

function entryForPath(path) {
  const normalized = normalizePath(path);
  return state.visibleRows.find((item) => item.path === normalized) || null;
}

function normalizedAbsolutePath(path) {
  return String(path || '').replace(/\/+$/, '');
}

function isPathInsideRoot(path, root) {
  const normalizedPath = normalizedAbsolutePath(path);
  const normalizedRoot = normalizedAbsolutePath(root);
  return Boolean(
    normalizedPath
      && normalizedRoot
      && (normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)),
  );
}

function paneRootDistance(pane) {
  const cwd = normalizedAbsolutePath(pane.workingDirectory);
  const root = normalizedAbsolutePath(state.activeRoot);
  if (!cwd || !root || !isPathInsideRoot(cwd, root)) return Number.POSITIVE_INFINITY;
  if (cwd === root) return 0;
  return cwd.slice(root.length + 1).split('/').length;
}

async function copyRelativePath(path) {
  const normalized = normalizePath(path);
  await copyText(normalized, 'Copied relative path');
}

async function copyAbsolutePath(path) {
  const absolutePath = resolveEditorFilePath(path);
  await copyText(absolutePath, 'Copied absolute path');
}

async function sendPathToFocusedAgent(path) {
  const normalized = normalizePath(path);
  const panes = await muxy().panes.list();
  const focusedPanes = Array.isArray(panes)
    ? panes
      .filter((pane) => pane.isFocused && paneRootDistance(pane) !== Number.POSITIVE_INFINITY)
      .sort((a, b) => paneRootDistance(a) - paneRootDistance(b))
    : [];

  if (focusedPanes.length === 0) {
    throw new Error('No focused agent pane in the active worktree.');
  }

  const failures = [];
  for (const pane of focusedPanes) {
    try {
      await muxy().panes.send(pane.id, `@${normalized}`);
      setTransientStatus(`Sent @${normalized} to ${pane.title || 'agent'}`, 'muted', 2400);
      return;
    } catch (error) {
      failures.push(error?.message || String(error));
    }
  }

  throw new Error(failures[0] || 'Could not send to focused agent pane.');
}

async function loadContext() {
  const previousKey = activeStorageKey();
  try {
    const [projects, worktrees] = await Promise.all([
      muxy().projects?.list?.().catch(() => []),
      muxy().worktrees?.list?.().catch(() => []),
    ]);
    const activeProject = Array.isArray(projects) ? projects.find((project) => project.isActive) : null;
    const activeWorktree = Array.isArray(worktrees) ? worktrees.find((worktree) => worktree.isActive) : null;
    state.activeRoot = activeWorktree?.path || activeProject?.path || null;
    state.activeName = activeWorktree?.name || activeProject?.name || '';
  } catch (error) {
    console.warn('Failed to load active Muxy context', error);
    state.activeRoot = null;
    state.activeName = '';
  }
  if (activeStorageKey() !== previousKey) {
    state.entries.clear();
    state.activePath = null;
    loadExpandedState();
  }
  updateContext();
}

async function loadDir(path, force = false) {
  const normalized = normalizePath(path);
  if (!force && state.entries.has(normalized)) return state.entries.get(normalized);
  if (state.loading.has(normalized)) return state.entries.get(normalized) || [];

  state.loading.add(normalized);
  render();
  try {
    const entries = await muxy().files.list(normalized);
    const normalizedEntries = entries.map((entry) => ({
      name: entry.name,
      path: normalizePath(entry.path || childPath(normalized, entry.name)),
      isDirectory: Boolean(entry.isDirectory),
      isIgnored: Boolean(entry.isIgnored),
    }));
    state.entries.set(normalized, normalizedEntries);
    return normalizedEntries;
  } catch (error) {
    console.error('Failed to list files', error);
    setStatus(`Could not load ${displayPath(normalized)}: ${error?.message || error}`, 'error');
    return [];
  } finally {
    state.loading.delete(normalized);
    render();
  }
}

async function refresh(force = true) {
  setStatus('Loading files...');
  await loadContext();
  if (force) state.entries.clear();
  await loadDir(ROOT, true);
  await loadExpandedDirectories();
  setStatus('');
  render();
}

async function loadExpandedDirectories() {
  const paths = [...state.expanded]
    .filter(Boolean)
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));

  for (const path of paths) {
    if (isKnownDirectory(path)) {
      await loadDir(path);
    }
  }
}

function scheduleRefresh() {
  window.clearTimeout(state.refreshTimer);
  state.refreshTimer = window.setTimeout(() => refresh(true), MAX_AUTO_REFRESH_DELAY);
}

function matchesFilter(entry) {
  if (!state.filter) return true;
  return entry.path.toLowerCase().includes(state.filter);
}

function branchContainsMatch(path) {
  if (!state.filter) return true;
  const entries = state.entries.get(path) || [];
  return entries.some((entry) => matchesFilter(entry) || (entry.isDirectory && branchContainsMatch(entry.path)));
}

function renderEntries(path, depth = 0) {
  const entries = state.entries.get(path) || [];
  if (state.loading.has(path) && entries.length === 0) {
    return `<div class="row loading" style="--depth:${depth}">Loading...</div>`;
  }

  return entries
    .filter((entry) => !state.filter || matchesFilter(entry) || (entry.isDirectory && branchContainsMatch(entry.path)))
    .map((entry) => {
      const expanded = entry.isDirectory && state.expanded.has(entry.path);
      const hasLoadedChildren = state.entries.has(entry.path);
      const ignoredClass = entry.isIgnored ? ' ignored' : '';
      const typeClass = entry.isDirectory ? ' directory' : ' file';
      const openClass = expanded ? ' expanded' : '';
      const buttonKind = entry.isDirectory ? 'toggle' : 'open';
      const aria = entry.isDirectory ? `aria-expanded="${expanded}"` : '';
      const rowIndex = state.visibleRows.push({
        path: entry.path,
        isDirectory: entry.isDirectory,
      }) - 1;
      const childMarkup = entry.isDirectory && expanded ? renderEntries(entry.path, depth + 1) : '';

      return `
        <button class="row${typeClass}${ignoredClass}${openClass}" style="--depth:${depth}" data-kind="${buttonKind}" data-path="${escapeHtml(entry.path)}" data-index="${rowIndex}" ${aria} aria-level="${depth + 1}" role="treeitem" tabindex="-1" type="button">
          <span class="caret">${entry.isDirectory ? (expanded ? '▾' : '▸') : ''}</span>
          ${fileIconMarkup(entry)}
          <span class="name">${escapeHtml(entry.name)}</span>
          ${entry.isDirectory && expanded && !hasLoadedChildren ? '<span class="spinner">Loading</span>' : ''}
        </button>
        ${childMarkup}
      `;
    })
    .join('');
}

function render() {
  const rootEntries = state.entries.get(ROOT);
  if (!rootEntries) {
    treeEl.innerHTML = '';
    state.visibleRows = [];
    state.activePath = null;
    return;
  }

  state.visibleRows = [];
  const content = renderEntries(ROOT);
  treeEl.innerHTML = content || `<div class="empty">${state.filter ? 'No matching files' : 'No files found'}</div>`;
  syncActiveRow();
}

function activeRowIndex() {
  return state.visibleRows.findIndex((row) => row.path === state.activePath);
}

function syncActiveRow({ focus = false } = {}) {
  const rows = [...treeEl.querySelectorAll('.row[data-path]')];
  if (rows.length === 0) {
    state.activePath = null;
    return;
  }

  if (activeRowIndex() === -1) {
    state.activePath = state.visibleRows[0]?.path || null;
  }

  let activeEl = null;
  rows.forEach((row) => {
    const active = row.dataset.path === state.activePath;
    row.classList.toggle('active', active);
    row.tabIndex = active ? 0 : -1;
    if (active) activeEl = row;
  });

  if (focus && activeEl) {
    activeEl.focus({ preventScroll: true });
    activeEl.scrollIntoView({ block: 'nearest' });
  }
}

function moveActiveRow(delta) {
  if (state.visibleRows.length === 0) return;
  const current = activeRowIndex();
  const fallback = delta > 0 ? 0 : state.visibleRows.length - 1;
  const next = Math.min(Math.max((current === -1 ? fallback : current + delta), 0), state.visibleRows.length - 1);
  state.activePath = state.visibleRows[next].path;
  syncActiveRow({ focus: true });
}

function setActiveRowAt(index) {
  if (state.visibleRows.length === 0) return;
  const next = Math.min(Math.max(index, 0), state.visibleRows.length - 1);
  state.activePath = state.visibleRows[next].path;
  syncActiveRow({ focus: true });
}

function clearFilter({ focusTree = false } = {}) {
  if (!state.filter && !filterEl.value) return;
  state.filter = '';
  filterEl.value = '';
  render();
  if (focusTree) syncActiveRow({ focus: true });
}

async function activatePath(path) {
  const row = state.visibleRows.find((item) => item.path === path);
  if (!row) return;
  if (row.isDirectory) {
    await toggleDirectory(path);
  } else {
    await openFile(path);
  }
}

async function toggleDirectory(path) {
  const normalized = normalizePath(path);
  if (state.expanded.has(normalized)) {
    state.expanded.delete(normalized);
    saveExpandedState();
    render();
    return;
  }

  state.expanded.add(normalized);
  saveExpandedState();
  render();
  await loadDir(normalized);
}

async function openFile(path) {
  const normalized = normalizePath(path);
  try {
    const filePath = resolveEditorFilePath(path);
    await muxy().tabs.open({ kind: 'editor', filePath });
  } catch (error) {
    console.error('Failed to open file', error);
    setStatus(`Could not open ${displayPath(normalized)}: ${error?.message || error}`, 'error');
  }
}

function closeMenu({ focusTree = false } = {}) {
  state.menuPath = null;
  menuEl.hidden = true;
  menuEl.innerHTML = '';
  if (focusTree) syncActiveRow({ focus: true });
}

async function runMenuAction(label, action) {
  try {
    await action();
  } catch (error) {
    console.error(`Failed to run menu action: ${label}`, error);
    setStatus(`${label} failed: ${error?.message || error}`, 'error');
  }
}

function createMenuButton(label, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('role', 'menuitem');
  button.textContent = label;
  button.addEventListener('click', async (event) => {
    event.stopPropagation();
    closeMenu();
    await runMenuAction(label, action);
  });
  return button;
}

function menuActionsFor(entry) {
  const path = entry.path;
  const primary = entry.isDirectory
    ? { label: 'Expand/Collapse', action: () => toggleDirectory(path) }
    : { label: 'Open in Muxy Editor', action: () => openFile(path) };

  return [
    primary,
    { label: 'Send @path to Agent', action: () => sendPathToFocusedAgent(path) },
    { label: 'Copy Relative Path', action: () => copyRelativePath(path) },
    { label: 'Copy Absolute Path', action: () => copyAbsolutePath(path) },
  ];
}

function openContextMenu(event, path) {
  const entry = entryForPath(path);
  if (!entry) return;

  event.preventDefault();
  state.activePath = entry.path;
  state.menuPath = entry.path;
  syncActiveRow();

  menuEl.replaceChildren(...menuActionsFor(entry).map(({ label, action }) => createMenuButton(label, action)));
  menuEl.hidden = false;
  menuEl.style.left = '0px';
  menuEl.style.top = '0px';

  const rect = menuEl.getBoundingClientRect();
  const left = Math.min(event.clientX, window.innerWidth - rect.width - 8);
  const top = Math.min(event.clientY, window.innerHeight - rect.height - 8);
  menuEl.style.left = `${Math.max(8, left)}px`;
  menuEl.style.top = `${Math.max(8, top)}px`;

  menuEl.querySelector('button')?.focus({ preventScroll: true });
}

treeEl.addEventListener('click', async (event) => {
  const row = event.target.closest('.row[data-path]');
  if (!row) return;
  closeMenu();
  const path = row.dataset.path || ROOT;
  state.activePath = path;
  syncActiveRow();
  await activatePath(path);
});

treeEl.addEventListener('contextmenu', (event) => {
  const row = event.target.closest('.row[data-path]');
  if (!row) return;
  openContextMenu(event, row.dataset.path || ROOT);
});

treeEl.addEventListener('keydown', async (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
    event.preventDefault();
    await copyActiveRelativePath();
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveActiveRow(1);
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveActiveRow(-1);
    return;
  }
  if (event.key === 'Home') {
    event.preventDefault();
    setActiveRowAt(0);
    return;
  }
  if (event.key === 'End') {
    event.preventDefault();
    setActiveRowAt(state.visibleRows.length - 1);
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    await activatePath(state.activePath);
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    if (!menuEl.hidden) {
      closeMenu({ focusTree: true });
      return;
    }
    clearFilter({ focusTree: true });
  }
});

filterEl.addEventListener('input', () => {
  closeMenu();
  state.filter = filterEl.value.trim().toLowerCase();
  render();
});

filterEl.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeMenu();
    clearFilter();
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    syncActiveRow({ focus: true });
  }
});

menuEl.addEventListener('keydown', (event) => {
  const buttons = [...menuEl.querySelectorAll('button')];
  const current = buttons.indexOf(document.activeElement);

  if (event.key === 'Escape') {
    event.preventDefault();
    closeMenu({ focusTree: true });
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    buttons[(current + 1 + buttons.length) % buttons.length]?.focus();
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    buttons[(current - 1 + buttons.length) % buttons.length]?.focus();
    return;
  }
  if (event.key === 'Home') {
    event.preventDefault();
    buttons[0]?.focus();
    return;
  }
  if (event.key === 'End') {
    event.preventDefault();
    buttons[buttons.length - 1]?.focus();
  }
});

window.addEventListener('pointerdown', (event) => {
  if (!menuEl.hidden && !event.target.closest('.menu')) closeMenu();
});

window.addEventListener('resize', closeMenu);
treeEl.addEventListener('scroll', closeMenu);

try {
  muxy().events?.subscribe?.('file.changed', scheduleRefresh);
  muxy().events?.subscribe?.('project.switched', () => {
    refresh(true);
  });
  muxy().events?.subscribe?.('worktree.switched', () => {
    refresh(true);
  });
  muxy().events?.subscribe?.('command.refresh-tree', () => refresh(true));
  muxy().events?.subscribe?.('command.copy-relative-path', copyActiveRelativePath);
} catch (error) {
  console.warn('Some Muxy event subscriptions failed', error);
}

refresh(true).catch((error) => {
  console.error(error);
  setStatus(error?.message || String(error), 'error');
});
