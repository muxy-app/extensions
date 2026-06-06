# Muxy File Tree Extension

A lightweight file tree panel for Muxy `0.29.x` extension builds.

This is a small, file-system read-only first pass:

- Adds a top bar folder button.
- Opens a pinned right-side `File Tree` panel.
- Lists the active worktree with `muxy.files.list`.
- Expands and collapses directories.
- Shows folder and common file type icons.
- Opens files in Muxy's built-in editor.
- Supports keyboard navigation with Up/Down, Enter, Home/End, and Escape to clear search.
- Copies the selected relative path from the context menu, Cmd/Ctrl+C inside the tree, or the extension shortcut.
- Adds a right-click menu for opening files in Muxy, copying relative/absolute paths, and inserting `@relative/path` into the focused agent pane for the active worktree.
- Preserves expanded folders per active worktree.
- Refreshes on `file.changed`, project switch, and worktree switch events.

## Status

Muxy's extension API is still marked as active development. The public docs and the Swift loader include `files:read`, but the checked-in JSON schema may lag behind that permission in some commits. This manifest follows the public docs and current Swift source.

The extension does not request `files:write` and does not delete, rename, move, or modify workspace files. The context menu uses `panes:read`/`panes:write` to insert `@relative/path` into the currently focused agent pane under the active worktree. Muxy may ask for runtime consent before those actions run.

## Local Install

```bash
npm install
npm run build
npm run install:local
```

Restart Muxy or use Settings -> Extensions -> Reload Extensions.

Default extension shortcuts:

- `Cmd+Opt+C`: copy the selected relative path.

The tree panel command does not ship with a default shortcut in the marketplace build, so it does not conflict with Muxy's built-in `Files` extension. You can map it in Settings -> Keyboard Shortcuts -> App Shortcuts under the extension group.

Muxy loads extensions from:

```text
~/.config/muxy/extensions/file-tree/
```

## Development Notes

The extension is intentionally vanilla JS and Vite only. That keeps the bundle small and makes the panel easy to adapt while Muxy's extension API is still moving.

Planned next steps:

- Add a simple "show ignored files" toggle.
- Improve loading and error states for large directories.
- Add optional write actions after the read-only panel is stable.
