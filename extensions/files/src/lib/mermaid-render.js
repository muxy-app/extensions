import { escape_html, h } from "@/lib/dom";

let mermaidPromise = null;
let initializedDark = null;
let renderSeq = 0;

async function get_mermaid(isDark) {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => mod.default ?? mod);
  }
  const mermaid = await mermaidPromise;
  if (initializedDark !== isDark) {
    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? "dark" : "default",
      securityLevel: "strict",
    });
    initializedDark = isDark;
  }
  return mermaid;
}

function cleanup_orphan(id) {
  document.getElementById(id)?.remove();
  document.getElementById(`d${id}`)?.remove();
}

function render_fallback(container, code, err) {
  console.warn("mermaid render failed", err);
  container.replaceChildren(
    h("pre", {}, h("code", {}, code)),
    h("div", { class: "md-mermaid-error" }, "Diagram could not be rendered"),
  );
}

export async function render_mermaid(container, code, isDark) {
  const id = `mermaid-${(renderSeq += 1)}`;
  try {
    const mermaid = await get_mermaid(isDark);
    if (!container.isConnected) return;
    const { svg, bindFunctions } = await mermaid.render(id, code);
    if (!container.isConnected) {
      cleanup_orphan(id);
      return;
    }
    container.innerHTML = svg;
    if (typeof bindFunctions === "function") bindFunctions(container);
  } catch (err) {
    cleanup_orphan(id);
    if (!container.isConnected) return;
    render_fallback(container, code, err);
  }
}
