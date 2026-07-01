# Files

Muxy file explorer and editor extension built with vanilla JavaScript, Vite, Tailwind CSS, `muxy.files`, and `muxy.tabs`.

```bash
npm install
npm run build
```

The panel entrypoint is `src/main.js`; the editor tab entrypoint is `src/editor/main.js`. Build output is written to `dist/`; reload the extension in Muxy after rebuilding.

## Keyboard navigation

The file tree is fully operable from the keyboard. Focus lands in the tree
automatically when the panel opens (or click any row), then:

| Key | Action |
| --- | --- |
| `↑` / `↓` | Move between visible rows |
| `→` | Expand a folder, or move to its first child if already open |
| `←` | Collapse a folder, or move to the parent folder |
| `Enter` / `Space` | Open the file, or toggle the folder |
| `Home` / `End` | Jump to the first / last row |
| `F2` | Rename the selected item |
| type a name | Type-ahead to the next matching entry |
