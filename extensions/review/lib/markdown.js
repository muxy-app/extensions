// Adapter for the `marked` markdown parser (declared in package.json). esbuild
// bundles it into review.bundle.js — same pattern as the CodeMirror and trees
// adapters — so the tab needs no committed vendor copy.
//
// We expose a single `renderMarkdown(src)` that returns an HTML string. GFM is
// on (tables, strikethrough, task lists, autolinks). The output is rendered
// ONLY inside a fully sandboxed iframe (sandbox="" — no scripts, opaque
// origin), so no separate HTML sanitizer is needed: any embedded <script> is
// inert and can't reach the parent document.
import { Marked } from 'marked';

const marked = new Marked({ gfm: true, breaks: false });

export function renderMarkdown(src) {
  return marked.parse(String(src ?? ''), { async: false });
}
