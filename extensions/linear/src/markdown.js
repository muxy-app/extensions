// 마크다운 렌더링(Linear 본문/코멘트 표시용).
// 이슈 본문에는 임의의 내용이 들어올 수 있으므로 반드시 살균(sanitize)한다 —
// 웹뷰는 git/exec/http 등 강력한 API를 가지므로 XSS 를 막아야 한다.

import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: true });

// 마크다운 → 안전한 HTML 문자열.
export function renderMarkdown(src) {
  const raw = marked.parse(String(src ?? ""));
  return DOMPurify.sanitize(raw, { ADD_ATTR: ["target"] });
}
