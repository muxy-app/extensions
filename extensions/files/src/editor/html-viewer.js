import { basename } from "@/lib/files";
import { h } from "@/lib/dom";

export class HtmlViewer {
  constructor({ parent, filePath, source }) {
    this.parent = parent;
    this.filePath = filePath;
    this.source = source ?? "";
    this.disposed = false;

    this.root = h("div", { class: "html-viewer" });
    this.frame = h("iframe", {
      class: "html-frame",
      sandbox: "allow-scripts allow-forms allow-popups allow-modals",
      title: basename(filePath),
      referrerpolicy: "no-referrer",
    });
    this.frame.setAttribute("srcdoc", this.source);
    this.root.append(this.frame);
    parent.replaceChildren(this.root);
  }

  getSource() {
    return this.source;
  }

  updateConfig() {}

  focus() {}

  destroy() {
    this.disposed = true;
    this.root?.remove();
    this.root = null;
    this.frame = null;
  }
}
