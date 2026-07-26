import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { read_binary_bytes } from "@/lib/binary-data";
import { error_message } from "@/lib/files";
import { format_file_size } from "@/lib/file-size";
import { cls, h, icon_svg } from "@/lib/dom";

const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const MIN_ZOOM = ZOOM_LEVELS[0];
const MAX_ZOOM = ZOOM_LEVELS.at(-1);
const WHEEL_ZOOM_DELAY_MS = 80;

const workerSrc = new URL(pdfWorkerUrl, document.baseURI).href;
let pdfjsPromise = null;

function load_pdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/build/pdf.mjs").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

function is_cancelled(err) {
  return err?.name === "RenderingCancelledException" || err?.name === "AbortException";
}

function pdf_asset_url(directory) {
  return new URL(`pdfjs/${directory}/`, workerSrc).href;
}

function PreviousIcon() {
  return icon_svg([{ d: "m15 18-6-6 6-6" }]);
}

function NextIcon() {
  return icon_svg([{ d: "m9 18 6-6-6-6" }]);
}

function ZoomOutIcon() {
  return icon_svg([{ d: "M5 12h14" }]);
}

function ZoomInIcon() {
  return icon_svg([{ d: "M12 5v14M5 12h14" }]);
}

export class PdfViewer {
  constructor({ parent, filePath }) {
    this.parent = parent;
    this.filePath = filePath;
    this.pdf = null;
    this.pdfjs = null;
    this.loadingTask = null;
    this.renderTask = null;
    this.textLayerTask = null;
    this.pageNumber = 1;
    this.pageCount = 0;
    this.fitPage = true;
    this.zoomScale = 1;
    this.currentScale = 1;
    this.disposed = false;
    this.renderId = 0;
    this.resizeRaf = 0;
    this.wheelZoomTimer = 0;
    this.wheelZoomDelta = 0;
    this.gestureStartScale = 1;
    this.gestureScale = 1;
    this.pageInput = null;
    this.passwordResponses = null;
    this.previousButton = null;
    this.nextButton = null;
    this.zoomOutButton = null;
    this.zoomInButton = null;
    this.zoomValueButton = null;
    this.fitButton = null;

    this.root = h("div", { class: "pdf-viewer" });
    this.stage = h(
      "div",
      { class: "pdf-stage", tabindex: "0", "aria-label": "PDF document" },
      h("div", { class: "pdf-status" }, "Loading…"),
    );
    this.toolbar = h("div", { class: "pdf-toolbar" });
    this.root.append(this.stage, this.toolbar);
    parent.replaceChildren(this.root);

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.stage);
    this.keyHandler = (event) => this.onKeyDown(event);
    this.wheelHandler = (event) => this.onWheel(event);
    this.gestureStartHandler = (event) => this.onGestureStart(event);
    this.gestureChangeHandler = (event) => this.onGestureChange(event);
    this.gestureEndHandler = (event) => this.onGestureEnd(event);
    this.root.addEventListener("keydown", this.keyHandler);
    this.stage.addEventListener("wheel", this.wheelHandler, { passive: false });
    this.stage.addEventListener("gesturestart", this.gestureStartHandler, { passive: false });
    this.stage.addEventListener("gesturechange", this.gestureChangeHandler, { passive: false });
    this.stage.addEventListener("gestureend", this.gestureEndHandler, { passive: false });
    void this.load();
  }

  async load() {
    try {
      const [data, pdfjs] = await Promise.all([
        read_binary_bytes(this.filePath, "PDF"),
        load_pdfjs(),
      ]);
      if (this.disposed) return;

      this.pdfjs = pdfjs;
      this.passwordResponses = pdfjs.PasswordResponses;
      const loadingTask = pdfjs.getDocument({
        data,
        cMapUrl: pdf_asset_url("cmaps"),
        cMapPacked: true,
        iccUrl: pdf_asset_url("iccs"),
        standardFontDataUrl: pdf_asset_url("standard_fonts"),
        wasmUrl: pdf_asset_url("wasm"),
      });
      this.loadingTask = loadingTask;
      loadingTask.onPassword = (updatePassword, reason) => {
        void this.requestPassword(updatePassword, reason);
      };

      const pdf = await loadingTask.promise;
      if (this.disposed) return;
      this.pdf = pdf;
      this.pageCount = pdf.numPages;
      this.renderToolbar();
      await this.renderPage();
    } catch (err) {
      if (this.disposed || is_cancelled(err)) return;
      this.showError(error_message(err));
    }
  }

  async requestPassword(updatePassword, reason) {
    const retry = reason === this.passwordResponses?.INCORRECT_PASSWORD;
    let password = null;
    try {
      password = await muxy.dialog.prompt({
        title: retry ? "Incorrect PDF password" : "Password-protected PDF",
        message: retry
          ? "That password was not accepted. Enter the PDF password to try again."
          : "Enter the password to open this PDF.",
        placeholder: "Password",
        confirm: "Open",
        cancel: "Cancel",
      });
    } catch {
      password = null;
    }

    if (this.disposed || password === null) {
      updatePassword(new Error("PDF password is required"));
      return;
    }
    updatePassword(password);
  }

  renderToolbar() {
    this.previousButton = h(
      "button",
      {
        type: "button",
        class: "pdf-icon-button",
        title: "Previous page",
        "aria-label": "Previous page",
        onClick: () => void this.setPage(this.pageNumber - 1),
      },
      PreviousIcon(),
    );
    this.pageInput = h("input", {
      type: "number",
      class: "pdf-page-input",
      min: "1",
      max: String(this.pageCount),
      value: String(this.pageNumber),
      "aria-label": "Page number",
      onChange: () => void this.commitPageInput(),
      onKeydown: (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        void this.commitPageInput();
      },
    });
    this.nextButton = h(
      "button",
      {
        type: "button",
        class: "pdf-icon-button",
        title: "Next page",
        "aria-label": "Next page",
        onClick: () => void this.setPage(this.pageNumber + 1),
      },
      NextIcon(),
    );

    const pageControls = h(
      "div",
      { class: "pdf-toolbar-group" },
      this.previousButton,
      this.pageInput,
      h("span", { class: "pdf-page-count" }, `of ${this.pageCount}`),
      this.nextButton,
    );
    const sizeSlot = h("span", { class: "pdf-meta-item" });
    const info = h("div", { class: "pdf-toolbar-info" }, pageControls, sizeSlot);

    this.zoomOutButton = h(
      "button",
      {
        type: "button",
        class: "pdf-icon-button",
        title: "Zoom out",
        "aria-label": "Zoom out",
        onClick: () => void this.zoomByStep(-1),
      },
      ZoomOutIcon(),
    );
    this.zoomValueButton = h(
      "button",
      {
        type: "button",
        class: "pdf-zoom-value",
        title: "Reset zoom to 100%",
        "aria-label": "Reset zoom to 100%",
        onClick: () => void this.setZoom(1),
      },
      "100%",
    );
    this.zoomInButton = h(
      "button",
      {
        type: "button",
        class: "pdf-icon-button",
        title: "Zoom in",
        "aria-label": "Zoom in",
        onClick: () => void this.zoomByStep(1),
      },
      ZoomInIcon(),
    );
    this.fitButton = h(
      "button",
      {
        type: "button",
        class: "pdf-zoom-toggle",
        title: "Fit page",
        "aria-label": "Fit page",
        onClick: () => void this.setFitPage(),
      },
      "Fit",
    );
    const zoomControls = h(
      "div",
      { class: "pdf-toolbar-group pdf-zoom-controls" },
      this.zoomOutButton,
      this.zoomValueButton,
      this.zoomInButton,
      this.fitButton,
    );
    this.toolbar.replaceChildren(info, zoomControls);
    this.updateToolbar();
    void this.addFileSize(sizeSlot);
  }

  async addFileSize(slot) {
    try {
      const stat = await muxy.files.stat(this.filePath);
      if (this.disposed) return;
      const label = format_file_size(stat?.size);
      if (label) slot.textContent = label;
    } catch {
    }
  }

  commitPageInput() {
    const requested = Number(this.pageInput?.value);
    if (!Number.isInteger(requested)) {
      this.updateToolbar();
      return;
    }
    return this.setPage(requested);
  }

  async setPage(pageNumber) {
    if (!this.pdf || this.pageCount < 1) return;
    const next = Math.max(1, Math.min(this.pageCount, pageNumber));
    if (next === this.pageNumber) {
      this.updateToolbar();
      return;
    }
    this.pageNumber = next;
    this.updateToolbar();
    this.stage.scrollTo({ top: 0, left: 0 });
    await this.renderPage();
  }

  async setFitPage() {
    if (this.fitPage) return;
    this.fitPage = true;
    this.updateToolbar();
    await this.renderPage();
  }

  async setZoom(scale) {
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale));
    if (!this.fitPage && Math.abs(next - this.zoomScale) < 0.001) return;
    this.fitPage = false;
    this.zoomScale = next;
    this.currentScale = next;
    this.updateToolbar();
    await this.renderPage();
  }

  zoomByStep(direction) {
    const scale = this.currentScale;
    const next = direction > 0
      ? ZOOM_LEVELS.find((level) => level > scale + 0.01) ?? MAX_ZOOM
      : ZOOM_LEVELS.findLast((level) => level < scale - 0.01) ?? MIN_ZOOM;
    return this.setZoom(next);
  }

  updateToolbar() {
    if (this.pageInput) this.pageInput.value = String(this.pageNumber);
    if (this.previousButton) this.previousButton.disabled = this.pageNumber <= 1;
    if (this.nextButton) this.nextButton.disabled = this.pageNumber >= this.pageCount;
    if (this.zoomOutButton) this.zoomOutButton.disabled = this.currentScale <= MIN_ZOOM;
    if (this.zoomInButton) this.zoomInButton.disabled = this.currentScale >= MAX_ZOOM;
    if (this.zoomValueButton) this.zoomValueButton.textContent = `${Math.round(this.currentScale * 100)}%`;
    if (this.fitButton) {
      this.fitButton.className = cls("pdf-zoom-toggle", this.fitPage && "pdf-zoom-toggle-active");
      this.fitButton.setAttribute("aria-pressed", String(this.fitPage));
    }
  }

  async renderPage() {
    if (!this.pdf || !this.pdfjs || this.disposed) return;
    const renderId = ++this.renderId;
    this.renderTask?.cancel();
    this.textLayerTask?.cancel();

    try {
      const page = await this.pdf.getPage(this.pageNumber);
      if (this.disposed || renderId !== this.renderId) return;
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = this.fitPage ? this.fitScale(baseViewport) : this.zoomScale;
      this.currentScale = scale;
      this.updateToolbar();
      const viewport = page.getViewport({ scale });
      const outputScale = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = h("canvas", {
        class: "pdf-page-canvas",
        "aria-label": `Page ${this.pageNumber} of ${this.pageCount}`,
      });
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not create the PDF canvas");

      canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
      canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      const textLayerElement = h("div", {
        class: "pdf-text-layer",
        "aria-label": `Selectable text for page ${this.pageNumber}`,
      });
      const textLayerTask = new this.pdfjs.TextLayer({
        textContentSource: page.streamTextContent({
          includeMarkedContent: true,
          disableNormalization: true,
        }),
        container: textLayerElement,
        viewport,
      });
      textLayerElement.style.width = `${Math.floor(viewport.width)}px`;
      textLayerElement.style.height = `${Math.floor(viewport.height)}px`;
      this.textLayerTask = textLayerTask;

      const pageElement = h("div", {
        class: "pdf-page",
        style: {
          width: `${Math.floor(viewport.width)}px`,
          height: `${Math.floor(viewport.height)}px`,
          "--total-scale-factor": String(scale),
          "--scale-round-x": "1px",
          "--scale-round-y": "1px",
        },
      });
      pageElement.append(canvas, textLayerElement);

      const renderTask = page.render({
        canvasContext: context,
        viewport,
        transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
        background: "white",
      });
      this.renderTask = renderTask;
      await Promise.all([renderTask.promise, textLayerTask.render()]);
      if (this.disposed || renderId !== this.renderId) return;

      this.stage.replaceChildren(pageElement);
      this.renderTask = null;
      this.textLayerTask = null;
    } catch (err) {
      if (this.disposed || renderId !== this.renderId || is_cancelled(err)) return;
      this.renderTask = null;
      this.textLayerTask = null;
      this.showError(error_message(err));
    }
  }

  fitScale(viewport) {
    const style = getComputedStyle(this.stage);
    const horizontalPadding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const verticalPadding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const availableWidth = Math.max(1, this.stage.clientWidth - horizontalPadding);
    const availableHeight = Math.max(1, this.stage.clientHeight - verticalPadding);
    return Math.min(1, availableWidth / viewport.width, availableHeight / viewport.height);
  }

  onResize() {
    if (!this.fitPage || !this.pdf || this.disposed || this.resizeRaf) return;
    this.resizeRaf = requestAnimationFrame(() => {
      this.resizeRaf = 0;
      void this.renderPage();
    });
  }

  onKeyDown(event) {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      void this.zoomByStep(1);
      return;
    }
    if (event.key === "-") {
      event.preventDefault();
      void this.zoomByStep(-1);
      return;
    }
    if (event.key === "0") {
      event.preventDefault();
      void this.setZoom(1);
    }
  }

  onWheel(event) {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    this.wheelZoomDelta += event.deltaY;
    if (this.wheelZoomTimer) window.clearTimeout(this.wheelZoomTimer);
    this.wheelZoomTimer = window.setTimeout(() => {
      this.wheelZoomTimer = 0;
      const factor = Math.exp(-this.wheelZoomDelta * 0.002);
      this.wheelZoomDelta = 0;
      void this.setZoom(Math.round(this.currentScale * factor * 100) / 100);
    }, WHEEL_ZOOM_DELAY_MS);
  }

  onGestureStart(event) {
    event.preventDefault();
    this.gestureStartScale = this.currentScale;
    this.gestureScale = 1;
  }

  onGestureChange(event) {
    event.preventDefault();
    this.gestureScale = Number.isFinite(event.scale) ? event.scale : 1;
  }

  onGestureEnd(event) {
    event.preventDefault();
    const scale = Number.isFinite(event.scale) ? event.scale : this.gestureScale;
    void this.setZoom(Math.round(this.gestureStartScale * scale * 100) / 100);
  }

  showError(message) {
    this.stage.replaceChildren(h("div", { class: "pdf-status pdf-status-error" }, message));
  }

  updateConfig() {}

  focus() {
    this.stage?.focus({ preventScroll: true });
  }

  destroy() {
    this.disposed = true;
    this.renderId += 1;
    if (this.resizeRaf) cancelAnimationFrame(this.resizeRaf);
    if (this.wheelZoomTimer) window.clearTimeout(this.wheelZoomTimer);
    this.resizeObserver?.disconnect();
    this.root?.removeEventListener("keydown", this.keyHandler);
    this.stage?.removeEventListener("wheel", this.wheelHandler);
    this.stage?.removeEventListener("gesturestart", this.gestureStartHandler);
    this.stage?.removeEventListener("gesturechange", this.gestureChangeHandler);
    this.stage?.removeEventListener("gestureend", this.gestureEndHandler);
    this.renderTask?.cancel();
    this.textLayerTask?.cancel();
    void this.loadingTask?.destroy?.();
    this.root?.remove();
    this.root = null;
    this.pdf = null;
    this.pdfjs = null;
    this.loadingTask = null;
    this.renderTask = null;
    this.textLayerTask = null;
  }
}
