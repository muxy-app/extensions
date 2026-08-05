const STORAGE_KEY = 'muxy-launcher:commands';
const CHANGE_EVENT = 'muxy-launcher:commands-changed';
const CHANGE_CHANNEL = 'muxy-launcher:commands';

const DEFAULT_COMMANDS = [
  { id: 'claude', name: 'Claude', command: 'claude', icon: '../icons/claude.svg', cwd: '' },
  { id: 'codex', name: 'Codex', command: 'codex', icon: '../icons/codex.svg', cwd: '' },
];

function defaults() {
  return DEFAULT_COMMANDS.map((c) => ({ ...c }));
}

function uid() {
  return 'cmd-' + Math.abs(Date.now() ^ (performance.now() * 1000)).toString(36) + Math.floor(performance.now() % 1000).toString(36);
}

export function loadCommands() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c) => c && typeof c.command === 'string').map(normalize);
  } catch {
    return defaults();
  }
}

export function resetCommands() {
  localStorage.removeItem(STORAGE_KEY);
  notifyCommandsChanged();
  return defaults();
}

export function saveCommands(commands) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(commands.map(normalize)));
  notifyCommandsChanged();
}

export function createCommand() {
  return { id: uid(), name: '', command: '', icon: 'terminal', cwd: '' };
}

function normalize(c) {
  return {
    id: c.id || uid(),
    name: String(c.name || '').trim(),
    command: String(c.command || '').trim(),
    icon: String(c.icon || 'terminal').trim(),
    cwd: String(c.cwd || '').trim(),
  };
}

export function onCommandsChanged(handler) {
  let channel = null;
  const reload = () => handler(loadCommands());
  const storageListener = (event) => {
    if (event.key === STORAGE_KEY || event.key === null) reload();
  };
  const visibilityListener = () => {
    if (!document.hidden) reload();
  };
  window.addEventListener('storage', storageListener);
  window.addEventListener(CHANGE_EVENT, reload);
  window.addEventListener('focus', reload);
  document.addEventListener('visibilitychange', visibilityListener);
  if ('BroadcastChannel' in window) {
    channel = new BroadcastChannel(CHANGE_CHANNEL);
    channel.addEventListener('message', reload);
  }
  return () => {
    window.removeEventListener('storage', storageListener);
    window.removeEventListener(CHANGE_EVENT, reload);
    window.removeEventListener('focus', reload);
    document.removeEventListener('visibilitychange', visibilityListener);
    channel?.close();
  };
}

function notifyCommandsChanged() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
  if ('BroadcastChannel' in window) {
    const channel = new BroadcastChannel(CHANGE_CHANNEL);
    channel.postMessage({ type: 'changed' });
    setTimeout(() => channel.close(), 0);
  }
}
