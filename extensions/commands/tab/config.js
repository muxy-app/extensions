import '../src/styles/global.css';
import { loadCommands, saveCommands, createCommand, resetCommands } from '../src/lib/store.js';
import { iconHTML, PRESET_ICONS, isImageSrc } from '../src/lib/icons.js';

const rowsEl = document.querySelector('#rows');
const emptyEl = document.querySelector('#empty');
const addBtn = document.querySelector('#add');
const resetBtn = document.querySelector('#reset');

let commands = loadCommands();

function persist() {
  saveCommands(commands);
}

function update(id, patch) {
  const item = commands.find((c) => c.id === id);
  if (!item) return;
  Object.assign(item, patch);
  persist();
}

function field(label, value, placeholder, onInput) {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const span = document.createElement('span');
  span.className = 'field-label';
  span.textContent = label;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  input.spellcheck = false;
  input.addEventListener('input', () => onInput(input.value));
  wrap.append(span, input);
  return wrap;
}

function iconPicker(cmd) {
  const wrap = document.createElement('div');
  wrap.className = 'field icon-field';
  const span = document.createElement('span');
  span.className = 'field-label';
  span.textContent = 'Icon';

  const grid = document.createElement('div');
  grid.className = 'icon-grid';

  const renderSelection = () => {
    grid.querySelectorAll('.icon-opt').forEach((el) => {
      el.classList.toggle('selected', el.dataset.icon === cmd.icon);
    });
  };

  const setIcon = (value) => {
    update(cmd.id, { icon: value });
    renderSelection();
    wrap.dispatchEvent(new Event('icon-change'));
  };

  for (const name of PRESET_ICONS) {
    const opt = document.createElement('button');
    opt.type = 'button';
    opt.className = 'icon-opt';
    opt.dataset.icon = name;
    opt.title = name;
    opt.innerHTML = iconHTML(name, 16);
    opt.addEventListener('click', () => setIcon(name));
    grid.appendChild(opt);
  }

  const emojiInput = document.createElement('input');
  emojiInput.type = 'text';
  emojiInput.className = 'emoji-input';
  emojiInput.maxLength = 2;
  emojiInput.placeholder = '😀';
  emojiInput.spellcheck = false;
  if (!isImageSrc(cmd.icon) && !PRESET_ICONS.includes(cmd.icon)) emojiInput.value = cmd.icon;
  emojiInput.addEventListener('input', () => {
    const v = emojiInput.value.trim();
    if (v) setIcon(v);
  });

  const emojiWrap = document.createElement('label');
  emojiWrap.className = 'emoji-wrap';
  const emojiLabel = document.createElement('span');
  emojiLabel.textContent = 'or emoji';
  emojiWrap.append(emojiLabel, emojiInput);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.svg,image/*';
  fileInput.className = 'hidden-file';
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setIcon(String(reader.result));
    reader.readAsDataURL(file);
    fileInput.value = '';
  });
  const uploadBtn = document.createElement('button');
  uploadBtn.type = 'button';
  uploadBtn.className = 'btn ghost';
  uploadBtn.textContent = 'Upload file…';
  uploadBtn.addEventListener('click', () => fileInput.click());

  const urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.className = 'url-input';
  urlInput.placeholder = 'https://…/icon.svg';
  urlInput.spellcheck = false;
  if (isImageSrc(cmd.icon) && /^https?:/i.test(cmd.icon)) urlInput.value = cmd.icon;
  urlInput.addEventListener('input', () => {
    const v = urlInput.value.trim();
    if (/^https?:\/\//i.test(v)) setIcon(v);
  });

  const sources = document.createElement('div');
  sources.className = 'icon-sources';
  sources.append(emojiWrap, uploadBtn, fileInput, urlInput);

  wrap.append(span, grid, sources);
  renderSelection();
  return wrap;
}

function move(id, delta) {
  const i = commands.findIndex((c) => c.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= commands.length) return;
  [commands[i], commands[j]] = [commands[j], commands[i]];
  persist();
  render();
}

function remove(id) {
  commands = commands.filter((c) => c.id !== id);
  persist();
  render();
}

function row(cmd, index) {
  const li = document.createElement('li');
  li.className = 'row';

  const head = document.createElement('div');
  head.className = 'row-head';
  const preview = document.createElement('span');
  preview.className = 'row-icon';
  preview.innerHTML = iconHTML(cmd.icon, 18);
  const title = document.createElement('span');
  title.className = 'row-title';
  title.textContent = cmd.name || cmd.command || 'Untitled';

  const actions = document.createElement('div');
  actions.className = 'row-actions';
  const up = iconButton('▲', 'Move up', () => move(cmd.id, -1), index === 0);
  const down = iconButton('▼', 'Move down', () => move(cmd.id, 1), index === commands.length - 1);
  const del = iconButton('✕', 'Remove', () => remove(cmd.id), false, 'danger');
  actions.append(up, down, del);
  head.append(preview, title, actions);

  const grid = document.createElement('div');
  grid.className = 'row-grid';
  grid.append(
    field('Name', cmd.name, 'Claude', (v) => { update(cmd.id, { name: v }); title.textContent = v || cmd.command || 'Untitled'; }),
    field('Command', cmd.command, 'claude', (v) => { update(cmd.id, { command: v }); if (!cmd.name) title.textContent = v || 'Untitled'; }),
    field('Working dir', cmd.cwd, 'optional, relative to worktree', (v) => update(cmd.id, { cwd: v })),
  );

  const picker = iconPicker(cmd);
  picker.addEventListener('icon-change', () => { preview.innerHTML = iconHTML(cmd.icon, 18); });

  li.append(head, grid, picker);
  return li;
}

function iconButton(glyph, label, onClick, disabled, extra) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn' + (extra ? ' ' + extra : '');
  btn.textContent = glyph;
  btn.title = label;
  btn.disabled = !!disabled;
  btn.addEventListener('click', onClick);
  return btn;
}

function render() {
  rowsEl.innerHTML = '';
  emptyEl.hidden = commands.length > 0;
  commands.forEach((cmd, i) => rowsEl.appendChild(row(cmd, i)));
}

addBtn.addEventListener('click', () => {
  commands.push(createCommand());
  persist();
  render();
});

resetBtn.addEventListener('click', async () => {
  const ok = await window.muxy?.dialog?.confirm?.({
    title: 'Reset to defaults?',
    message: 'This removes all your commands and restores Claude and Codex.',
    confirmText: 'Reset',
    cancelText: 'Cancel',
  });
  if (ok === false) return;
  commands = resetCommands();
  render();
});

render();
