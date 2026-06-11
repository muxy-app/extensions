// Entry for the @pierre/trees bundle. esbuild inlines preact + preact-render-to-string,
// producing one self-contained ESM file so the tab needs no import map.
export { FileTree, preparePresortedFileTreeInput, prepareFileTreeInput, themeToTreeStyles } from '@pierre/trees';
