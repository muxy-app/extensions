import { read_image_data_url } from "@/lib/image-data";
import { error_message } from "@/lib/files";
import { h } from "@/lib/dom";

function format_size(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

// Renders an image file on the editor surface. Exposes the same child contract
// the editor expects (`destroy()`); it never reports dirty state or save, since
// images are read-only here.
export class ImageViewer {
  constructor({ parent, filePath, svgSource = null }) {
    this.parent = parent;
    this.filePath = filePath;
    this.svgSource = svgSource;
    this.actualSize = false;
    this.disposed = false;
    this.fitButton = null;
    this.stage = null;
    this.img = null;

    this.root = h("div", { class: "image-viewer" });
    this.stage = h("div", { class: "image-stage" }, h("div", { class: "image-status" }, "Loading…"));
    this.meta = h("div", { class: "image-meta" });
    this.root.append(this.stage, this.meta);
    parent.replaceChildren(this.root);

    void this.load();
  }

  async load() {
    let dataUrl;
    if (this.svgSource !== null) {
      // SVG text is already in hand; encode it inline rather than re-reading.
      dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(this.svgSource)}`;
    } else {
      try {
        dataUrl = await read_image_data_url(this.filePath);
      } catch (err) {
        if (this.disposed) return;
        this.stage.replaceChildren(
          h("div", { class: "image-status image-status-error" }, error_message(err)),
        );
        return;
      }
    }
    if (this.disposed) return;

    const img = h("img", {
      class: "image-canvas",
      src: dataUrl,
      alt: this.filePath,
      draggable: false,
    });
    img.addEventListener("load", () => {
      if (this.disposed) return;
      this.renderMeta(img.naturalWidth, img.naturalHeight);
    });
    img.addEventListener("error", () => {
      if (this.disposed) return;
      this.stage.replaceChildren(
        h("div", { class: "image-status image-status-error" }, "Could not display this image"),
      );
    });
    this.img = img;
    this.applyZoom();
    this.stage.replaceChildren(img);
  }

  renderMeta(width, height) {
    const info = h("div", { class: "image-meta-info" });
    if (width && height) {
      info.appendChild(h("span", { class: "image-meta-item" }, `${width} × ${height}`));
    }
    // Filled in asynchronously by addFileSize; appended now to keep order stable.
    const sizeSlot = h("span", { class: "image-meta-item" });
    info.appendChild(sizeSlot);
    void this.addFileSize(sizeSlot);

    this.fitButton = h(
      "button",
      {
        type: "button",
        class: "image-zoom-toggle",
        onClick: () => this.toggleZoom(),
      },
      this.actualSize ? "Fit" : "Actual size",
    );

    this.meta.replaceChildren(info, this.fitButton);
  }

  async addFileSize(slot) {
    try {
      const stat = await muxy.files.stat(this.filePath);
      if (this.disposed) return;
      const label = format_size(stat?.size);
      if (label) slot.textContent = label;
    } catch {
      // Size is supplementary; ignore failures.
    }
  }

  toggleZoom() {
    this.actualSize = !this.actualSize;
    if (this.fitButton) this.fitButton.textContent = this.actualSize ? "Fit" : "Actual size";
    this.applyZoom();
  }

  applyZoom() {
    if (!this.img) return;
    this.img.classList.toggle("image-canvas-actual", this.actualSize);
    this.stage.classList.toggle("image-stage-scroll", this.actualSize);
  }

  // The editor calls updateConfig on theme/config changes; images don't react.
  updateConfig() {}

  focus() {}

  destroy() {
    this.disposed = true;
    this.root?.remove();
    this.root = null;
    this.img = null;
  }
}
