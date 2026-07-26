# Commands

A pinned command launcher for Muxy. Keep your favorite CLI tools — `claude`,
`codex`, or anything else — one click away from the topbar. Each command opens
in a fresh interactive terminal.

## Usage

- Click the bolt icon in the topbar to open the launcher.
- Pick a command to run it in a new terminal tab.
- Keyboard: `↑`/`↓` to move, `Enter` to run, `Esc` to close, and number keys
  `1`–`9` to run that command directly. With many commands a search box appears
  for filtering.
- Click **Manage commands** to add, edit, reorder, or remove commands.

Each command has a **name**, the **command** to run, an optional **working dir**
relative to the active worktree root, and an **icon**. Icons can be a built-in
glyph, an emoji, an uploaded image file, or an image URL — **Reset to defaults**
restores the built-in Claude and Codex commands.

## Develop

```bash
npm install --ignore-scripts
npm run build
```

Then **Load Unpacked** this folder in the Muxy Extensions modal, or **Reload**
after rebuilding.
