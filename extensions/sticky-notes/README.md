# Sticky Notes

Colorful sticky notes that float over every project in Muxy.

- Notes float above the window in every project and stay where you put them.
- Drag the top strip to move a note, and drag its edges to resize it.
- **●** picks one of six colors, **+** adds a note beside the current one, and
  **×** deletes it. A note with text asks before it's deleted.
- Your text, colors, sizes and positions are saved, and they come back when
  Muxy restarts.
- You can have up to 32 notes.

## Commands

| Command | Shortcut |
| --- | --- |
| Sticky Notes: New Note | `Ctrl+Opt+N` |
| Sticky Notes: Show/Hide Notes | `Ctrl+Opt+Shift+N` |
| Sticky Notes: Show All Notes | — |
| Sticky Notes: Hide All Notes | — |

The top bar also has a **New Sticky Note** button.

## Permissions

| Permission | Why |
| --- | --- |
| `panels:write` | Opens, closes and positions each note as a floating panel. |
| `storage:read` | Reads your saved notes, so they come back when Muxy restarts. |
| `storage:write` | Saves each note's text, color, size and position as you edit. |

Notes stay on your computer, in this extension's storage. The extension doesn't
use the network, your files, or your terminals.

## Development

```bash
npm run build   # copies the source into dist/, which Muxy loads
```

## License

MIT
