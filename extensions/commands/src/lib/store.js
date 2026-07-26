const STORAGE_KEY = 'muxy-launcher:commands';

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
  return defaults();
}

export function saveCommands(commands) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(commands.map(normalize)));
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
  const listener = (event) => {
    if (event.key === STORAGE_KEY) handler(loadCommands());
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}
