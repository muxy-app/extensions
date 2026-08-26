import { clamp } from "@/lib/photo-math";
import { h } from "@/lib/dom";

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const MIN_FRACTION = 0.02;

function opposite(handle) {
  return {
    nw: { x: 1, y: 1 },
    n: { x: 0.5, y: 1 },
    ne: { x: 0, y: 1 },
    e: { x: 0, y: 0.5 },
    se: { x: 0, y: 0 },
    s: { x: 0.5, y: 0 },
    sw: { x: 1, y: 0 },
    w: { x: 1, y: 0.5 },
  }[handle];
}

/**
 * Draggable crop rectangle drawn on top of the preview canvas. Works in
 * normalized (0..1) coordinates so the same rectangle survives zooming,
 * straightening and window resizes.
 */
export class CropOverlay {
  constructor({ parent, onChange, onCommit, onApply, onBegin }) {
    this.onChange = onChange;
    this.onCommit = onCommit;
    this.onApply = onApply;
    this.onBegin = onBegin;
    this.rect = { x: 0, y: 0, width: 1, height: 1 };
    this.aspect = null;
    this.drag = null;

    this.box = h(
      "div",
      { class: "photo-crop-box", tabindex: "0" },
      h("div", { class: "photo-crop-grid" }),
      HANDLES.map((handle) =>
        h("div", { class: `photo-crop-handle photo-crop-handle-${handle}`, dataset: { handle } }),
      ),
    );
    this.root = h("div", { class: "photo-crop-layer" }, this.box);
    parent.appendChild(this.root);

    this.onPointerDown = (event) => this.startDrag(event);
    this.onPointerMove = (event) => this.moveDrag(event);
    this.onPointerUp = (event) => this.endDrag(event);
    this.onKeyDown = (event) => this.handleKey(event);

    this.root.addEventListener("pointerdown", this.onPointerDown);
    this.root.addEventListener("pointermove", this.onPointerMove);
    this.root.addEventListener("pointerup", this.onPointerUp);
    this.root.addEventListener("pointercancel", this.onPointerUp);
    this.box.addEventListener("keydown", this.onKeyDown);
    this.onDoubleClick = () => this.onApply?.();
    this.box.addEventListener("dblclick", this.onDoubleClick);
  }

  setFrame(frame) {
    this.root.style.left = `${frame.left}px`;
    this.root.style.top = `${frame.top}px`;
    this.root.style.width = `${frame.width}px`;
    this.root.style.height = `${frame.height}px`;
  }

  setRect(rect) {
    this.rect = rect ?? { x: 0, y: 0, width: 1, height: 1 };
    this.paint();
  }

  setAspect(aspect) {
    this.aspect = aspect && aspect > 0 ? aspect : null;
  }

  setVisible(visible) {
    this.root.classList.toggle("photo-crop-layer-hidden", !visible);
  }

  paint() {
    const { x, y, width, height } = this.rect;
    this.box.style.left = `${x * 100}%`;
    this.box.style.top = `${y * 100}%`;
    this.box.style.width = `${width * 100}%`;
    this.box.style.height = `${height * 100}%`;
  }

  isFull() {
    const epsilon = 0.001;
    return (
      this.rect.x < epsilon &&
      this.rect.y < epsilon &&
      this.rect.width > 1 - epsilon &&
      this.rect.height > 1 - epsilon
    );
  }

  size() {
    const bounds = this.root.getBoundingClientRect();
    return { width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) };
  }

  // Aspect is expressed against the displayed image, so the ratio has to be
  // converted into normalized units before it can constrain the rectangle.
  normalizedAspect() {
    if (!this.aspect) return null;
    const size = this.size();
    return this.aspect * (size.height / size.width);
  }

  startDrag(event) {
    if (event.button !== 0) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const handle = target?.dataset?.handle ?? null;
    const inside = target === this.box || Boolean(target?.closest(".photo-crop-grid"));
    const size = this.size();
    const point = this.pointOf(event, size);
    if (handle || inside) this.onBegin?.();

    if (handle) {
      this.drag = { kind: "resize", handle, size };
    } else if (inside && this.isFull()) {
      // Nothing is cropped yet, so the whole picture is "inside" the rectangle.
      // Dragging there has to draw a new crop — moving a full-size rectangle
      // could not go anywhere anyway.
      this.drag = { kind: "draw", origin: point, size };
      this.rect = { x: point.x, y: point.y, width: MIN_FRACTION, height: MIN_FRACTION };
    } else if (inside) {
      this.drag = { kind: "move", size, offsetX: point.x - this.rect.x, offsetY: point.y - this.rect.y };
    } else {
      // Dragging on the shaded area draws a brand new rectangle.
      this.drag = { kind: "draw", origin: point, size };
      this.rect = { x: point.x, y: point.y, width: MIN_FRACTION, height: MIN_FRACTION };
    }

    this.root.setPointerCapture(event.pointerId);
    this.box.focus({ preventScroll: true });
    event.preventDefault();
  }

  pointOf(event, size) {
    const bounds = this.root.getBoundingClientRect();
    return {
      x: clamp((event.clientX - bounds.left) / size.width, 0, 1),
      y: clamp((event.clientY - bounds.top) / size.height, 0, 1),
    };
  }

  moveDrag(event) {
    if (!this.drag) return;
    const point = this.pointOf(event, this.drag.size);
    if (this.drag.kind === "move") this.applyMove(point);
    else if (this.drag.kind === "resize") this.applyResize(this.drag.handle, point);
    else this.applyDraw(point);
    this.paint();
    this.onChange?.(this.rect);
  }

  applyMove(point) {
    const width = this.rect.width;
    const height = this.rect.height;
    this.rect = {
      x: clamp(point.x - this.drag.offsetX, 0, 1 - width),
      y: clamp(point.y - this.drag.offsetY, 0, 1 - height),
      width,
      height,
    };
  }

  applyDraw(point) {
    const origin = this.drag.origin;
    let left = Math.min(origin.x, point.x);
    let top = Math.min(origin.y, point.y);
    let width = Math.abs(point.x - origin.x);
    let height = Math.abs(point.y - origin.y);
    const aspect = this.normalizedAspect();
    if (aspect) {
      if (width / height > aspect) width = height * aspect;
      else height = width / aspect;
      if (point.x < origin.x) left = origin.x - width;
      if (point.y < origin.y) top = origin.y - height;
    }
    this.rect = this.clampRect({ x: left, y: top, width, height });
  }

  applyResize(handle, point) {
    const anchor = opposite(handle);
    const rect = this.rect;
    let left = rect.x;
    let right = rect.x + rect.width;
    let top = rect.y;
    let bottom = rect.y + rect.height;

    if (handle.includes("w")) left = Math.min(point.x, right - MIN_FRACTION);
    if (handle.includes("e")) right = Math.max(point.x, left + MIN_FRACTION);
    if (handle.includes("n")) top = Math.min(point.y, bottom - MIN_FRACTION);
    if (handle.includes("s")) bottom = Math.max(point.y, top + MIN_FRACTION);

    let width = right - left;
    let height = bottom - top;
    const aspect = this.normalizedAspect();
    if (aspect) {
      const horizontal = handle === "e" || handle === "w";
      const vertical = handle === "n" || handle === "s";
      if (horizontal) height = width / aspect;
      else if (vertical) width = height * aspect;
      else if (width / height > aspect) width = height * aspect;
      else height = width / aspect;

      // Grow away from the handle's opposite corner/edge.
      left = anchor.x === 1 ? right - width : anchor.x === 0 ? left : left + (right - left) / 2 - width / 2;
      top = anchor.y === 1 ? bottom - height : anchor.y === 0 ? top : top + (bottom - top) / 2 - height / 2;
    }

    this.rect = this.clampRect({ x: left, y: top, width, height });
  }

  clampRect(rect) {
    const width = clamp(rect.width, MIN_FRACTION, 1);
    const height = clamp(rect.height, MIN_FRACTION, 1);
    return {
      x: clamp(rect.x, 0, 1 - width),
      y: clamp(rect.y, 0, 1 - height),
      width,
      height,
    };
  }

  endDrag(event) {
    if (!this.drag) return;
    this.drag = null;
    if (this.root.hasPointerCapture?.(event.pointerId)) this.root.releasePointerCapture(event.pointerId);
    this.onCommit?.(this.rect);
  }

  handleKey(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      this.onApply?.();
      return;
    }
    const step = (event.shiftKey ? 10 : 1) / Math.max(1, this.size().width);
    const stepY = (event.shiftKey ? 10 : 1) / Math.max(1, this.size().height);
    let next = null;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) this.onBegin?.();
    if (event.key === "ArrowLeft") next = { ...this.rect, x: this.rect.x - step };
    else if (event.key === "ArrowRight") next = { ...this.rect, x: this.rect.x + step };
    else if (event.key === "ArrowUp") next = { ...this.rect, y: this.rect.y - stepY };
    else if (event.key === "ArrowDown") next = { ...this.rect, y: this.rect.y + stepY };
    if (!next) return;
    event.preventDefault();
    this.rect = this.clampRect(next);
    this.paint();
    this.onChange?.(this.rect);
    this.onCommit?.(this.rect);
  }

  destroy() {
    this.root.removeEventListener("pointerdown", this.onPointerDown);
    this.root.removeEventListener("pointermove", this.onPointerMove);
    this.root.removeEventListener("pointerup", this.onPointerUp);
    this.root.removeEventListener("pointercancel", this.onPointerUp);
    this.box.removeEventListener("keydown", this.onKeyDown);
    this.box.removeEventListener("dblclick", this.onDoubleClick);
    this.root.remove();
  }
}
