// Convert an HTML email body into readable plain text, the way a terminal mail
// reader (w3m / lynx style) does. Parsing goes through DOMParser, which never
// runs scripts or loads remote resources, so this is safe to feed untrusted
// HTML.

const BLOCK = new Set([
  "p", "div", "section", "article", "header", "footer", "table", "tr",
  "ul", "ol", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "figure",
]);

function walk(node, lines) {
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent.replace(/\s+/g, " ");
      if (text) lines.push({ type: "text", text });
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const tag = child.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "head" || tag === "noscript") continue;

    if (tag === "br") {
      lines.push({ type: "break" });
      continue;
    }
    if (tag === "hr") {
      lines.push({ type: "break" });
      lines.push({ type: "text", text: "—".repeat(24) });
      lines.push({ type: "break" });
      continue;
    }
    const block = BLOCK.has(tag) || tag === "li";
    if (block) lines.push({ type: "break" });
    if (tag === "li") lines.push({ type: "text", text: "• " });

    if (tag === "a") {
      const href = child.getAttribute("href") || "";
      const label = child.textContent.replace(/\s+/g, " ").trim();
      if (href && !href.startsWith("mailto:") && label && label !== href) {
        lines.push({ type: "text", text: `${label} (${href})` });
      } else {
        lines.push({ type: "text", text: label || href });
      }
      continue;
    }

    walk(child, lines);
    if (block) lines.push({ type: "break" });
  }
}

export function htmlToText(html) {
  let doc;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return "";
  }
  const lines = [];
  walk(doc.body || doc.documentElement, lines);

  // Fold the token stream into text, collapsing runs of blank lines.
  let out = "";
  let atLineStart = true;
  let blanks = 0;
  for (const token of lines) {
    if (token.type === "break") {
      if (!atLineStart) {
        out += "\n";
        atLineStart = true;
      } else if (blanks < 1) {
        out += "\n";
        blanks++;
      }
    } else {
      let text = token.text;
      if (atLineStart) text = text.replace(/^\s+/, "");
      if (text) {
        out += text;
        atLineStart = false;
        blanks = 0;
      }
    }
  }
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
