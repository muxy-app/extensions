# git

Official Git extension for Muxy

## Stack

- NPM
- Shadcn
- Tailwindcss
- React

## Building & editing

Install deps with `npm install --ignore-scripts`, then `npm run build` (runs `tsc --noEmit`
then `vite build`) to produce `dist/panel.js` + `dist/panel.css`. After
rebuilding, click "Reload" in the Muxy Extensions modal to pick up the
changes. `npm run typecheck` runs the type check alone.

## Guides

- Never use code comments. if you see anywhere, remove
- Write less code, small components, re-usable code.
- Avoid large files
- Don't patch symptoms and fix the root cause
