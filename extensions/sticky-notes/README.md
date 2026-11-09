# Sticky Notes

Sticky notes that live on an edge of Muxy's window, out of the way until you
want them.

- Every note is a colored ribbon on the edge of the window. Move the pointer
  over them and they swell like the macOS Dock, with a label naming each note.
  The area that responds is wider than the ribbons, so they're easy to hit.
- Click a ribbon to open its note right beside it. Esc, the arrow button, or a
  click anywhere else in Muxy puts it away.
- Right-click **+**, or run **Sticky Notes: Settings**, to move the ribbons to
  the start, middle, or end of any edge, and to make them slimmer or larger.
- Notes save as you type, and grow to fit their text.
- Type `[]` at the start of a line for a checklist box. Click a box to tick it.
  Enter continues a checklist or a `-` list, and Enter on an empty item ends it.
- **⌥↑** and **⌥↓** move between notes while one is open.
- The dot at the bottom picks a color. **Everywhere** switches a note to show
  only in the current project, and back.
- Right-click a ribbon for that note's menu: its colors, **Open**,
  **Settings…**, and **Delete**.
- Deleting a note, from the trash button or the menu, shows **Undo** for a few
  seconds. A new note you leave empty is dropped on its own.

## Commands

| Command | Shortcut |
| --- | --- |
| Sticky Notes: New Note | `Ctrl+Opt+N` |
| Sticky Notes: Show/Hide Notes | `Ctrl+Opt+Shift+N` |
| Sticky Notes: Show All Notes | — |
| Sticky Notes: Hide All Notes | — |
| Sticky Notes: Settings | — |

The top bar also has a **New Sticky Note** button.

## Permissions

| Permission | Why |
| --- | --- |
| `panels:write` | Shows the notes in a see-through panel over the window. Only the ribbons and what they open take clicks. |
| `projects:read` | Knows the current project, for notes kept to one project. |
| `storage:read` | Reads your saved notes, so they come back when Muxy restarts. |
| `storage:write` | Saves each note's title, text, color and project as you edit. |

Notes stay on your computer, in this extension's storage. The extension doesn't
use the network, your files, or your terminals.

## Development

```bash
npm run build   # copies the source into dist/, which Muxy loads
```

## License

MIT
