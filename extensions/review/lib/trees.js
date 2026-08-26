// Adapter for @pierre/trees (declared in package.json). esbuild bundles it —
// inlining preact + preact-render-to-string — into review.bundle.js, so the tab
// needs no import map and no committed vendor copy.
export { FileTree, preparePresortedFileTreeInput, prepareFileTreeInput, themeToTreeStyles } from '@pierre/trees';
