import { basename, confirm_action, error_message, extname } from "@/lib/files";
import { ext_for_mime, image_mime, is_encodable_image, is_lossy_mime } from "@/lib/languages";
import { read_image_data_url } from "@/lib/image-data";
import { blob_to_base64, path_exists, write_binary_file } from "@/lib/image-write";
import {
  clamp,
  copy_path_candidate,
  fit_scale,
  inscribed_size,
  normalize_angle,
  replace_ext,
  resize_dims,
  scale_dims,
} from "@/lib/photo-math";
import { cls, h } from "@/lib/dom";
import { crop_rect_px, canvas_to_blob, preview_source, render, stage_size } from "@/photo/pipeline";
import { CropOverlay } from "@/photo/crop-overlay";
import { initial_state, neutral_adjust, state_is_clean } from "@/photo/state";
import { number_field, row, section, segmented, slider, toggle, tool_button } from "@/photo/controls";
import {
  CheckIcon,
  ColorIcon,
  CopyFileIcon,
  CropIcon,
  FlipHorizontalIcon,
  FlipVerticalIcon,
  RedoIcon,
  ResetIcon,
  ResizeIcon,
  RotateLeftIcon,
  RotateRightIcon,
  TrimIcon,
  UndoIcon,
} from "@/photo/icons";
import { SaveIcon } from "@/editor/icons";

const PREVIEW_MAX = 2200;
const HISTORY_LIMIT = 60;
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
const ASPECTS = [
  { label: "Free", value: null },
  { label: "Original", value: "original" },
  { label: "1:1", value: 1 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:2", value: 3 / 2 },
  { label: "16:9", value: 16 / 9 },
];
const FULL_CROP = { x: 0, y: 0, width: 1, height: 1 };

function format_dims(width, height) {
  return `${Math.round(width)} × ${Math.round(height)}`;
}

/**
 * The photo editor: mirror, straighten to a tenth of a degree, crop, resize and
 * grade an image, then write it back to the workspace. Preview and export share
 * one render pipeline, so the saved file matches what is on screen.
 */
export class PhotoEditor {
  constructor({ parent, filePath, onDirty }) {
    this.parent = parent;
    this.filePath = filePath;
    this.onDirty = onDirty;
    this.disposed = false;
    this.image = null;
    this.preview = null;
    this.state = null;
    this.tool = "crop";
    this.cropApplied = false;
    this.zoom = 0; // 0 == fit to the stage
    this.quality = 92;
    this.format = "original";
    this.saving = false;
    this.dirty = false;
    this.overwriteConfirmed = false;
    this.lastWriteAt = 0;
    this.frame = 0;
    this.fields = {};
    this.undoStack = [];
    this.redoStack = [];
    this.snapshotPending = false;

    this.stage = h("div", { class: "photo-stage" });
    this.holder = h("div", { class: "photo-holder" });
    this.stage.appendChild(this.holder);
    this.panel = h("div", { class: "photo-panel" });
    this.toolbar = h("div", { class: "photo-tools" });
    this.footer = h("div", { class: "photo-footer" });
    this.sidebar = h("div", { class: "photo-sidebar" }, this.toolbar, this.panel, this.footer);
    this.status = h("div", { class: "photo-status" }, "Loading…");
    this.root = h("div", { class: "photo-editor" }, h("div", { class: "photo-stage-wrap" }, this.stage, this.status), this.sidebar);
    parent.replaceChildren(this.root);

    this.onResize = () => this.scheduleRender();
    window.addEventListener("resize", this.onResize);

    // On window, not the root: the shortcuts have to work even when focus sits
    // on the tab body rather than inside the crop rectangle.
    this.onKeyDown = (event) => this.handleKey(event);
    window.addEventListener("keydown", this.onKeyDown);

    void this.load();
  }

  async load() {
    let dataUrl;
    try {
      dataUrl = await read_image_data_url(this.filePath);
    } catch (err) {
      this.fail(error_message(err));
      return;
    }
    if (this.disposed) return;

    const image = new Image();
    image.src = dataUrl;
    try {
      await image.decode();
    } catch {
      this.fail("Could not decode this image");
      return;
    }
    if (this.disposed) return;

    this.image = image;
    this.preview = preview_source(image, PREVIEW_MAX);
    this.state = initial_state(image.naturalWidth, image.naturalHeight);
    this.state.crop = { ...FULL_CROP };
    this.status.remove();

    this.overlay = new CropOverlay({
      parent: this.holder,
      onChange: (rect) => this.onCropDrag(rect),
      onCommit: () => this.commitCrop(),
      onApply: () => this.applyCrop(),
      onBegin: () => this.snapshot(),
    });

    this.renderToolbar();
    this.renderPanel();
    this.renderFooter();
    this.scheduleRender();
  }

  fail(message) {
    this.status.textContent = message;
    this.status.classList.add("photo-status-error");
  }

  // ----------------------------------------------------------------- history

  cloneState() {
    return JSON.parse(JSON.stringify(this.state));
  }

  /**
   * Remember the state as it is *before* the edit that is about to happen.
   * Calls that land in the same task collapse into one entry, so a button that
   * changes two things is still a single undo step; a slider drag pushes once
   * from its `onBegin` rather than once per frame.
   */
  snapshot() {
    if (!this.state || this.snapshotPending) return;
    this.snapshotPending = true;
    queueMicrotask(() => {
      this.snapshotPending = false;
    });
    this.undoStack.push(this.cloneState());
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
    this.updateHistoryButtons();
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.cloneState());
    this.restore(this.undoStack.pop());
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.cloneState());
    this.restore(this.redoStack.pop());
  }

  restore(state) {
    this.state = state;
    this.cropApplied = false;
    this.overlay?.setAspect(this.resolvedAspect());
    this.syncDirty();
    this.renderPanel();
    this.updateHistoryButtons();
    this.scheduleRender();
  }

  clearHistory() {
    this.undoStack = [];
    this.redoStack = [];
    this.updateHistoryButtons();
  }

  updateHistoryButtons() {
    if (this.undoButton) this.undoButton.disabled = this.undoStack.length === 0;
    if (this.redoButton) this.redoButton.disabled = this.redoStack.length === 0;
  }

  resolvedAspect() {
    const value = this.state?.aspect;
    if (value === "original") return this.image.naturalWidth / this.image.naturalHeight;
    return typeof value === "number" && value > 0 ? value : null;
  }

  // ---------------------------------------------------------------- geometry

  stageBounds() {
    return stage_size(this.image.naturalWidth, this.image.naturalHeight, this.state.angle);
  }

  cropSize() {
    const crop = crop_rect_px(this.state.crop, this.stageBounds());
    return { width: crop.width, height: crop.height };
  }

  cropAspect() {
    const size = this.cropSize();
    return size.width / size.height;
  }

  showsCrop() {
    if (this.tool === "rotate") return true;
    return this.tool === "crop" && !this.cropApplied;
  }

  // Enter / double-click / the Apply button: stop drawing the rectangle and
  // show the cropped result. The crop itself already lives in the state — this
  // only switches what the stage previews.
  applyCrop() {
    if (this.cropApplied) return;
    this.cropApplied = true;
    this.renderPanel();
    this.scheduleRender();
  }

  editCrop() {
    if (!this.cropApplied) return;
    this.cropApplied = false;
    this.renderPanel();
    this.scheduleRender();
    requestAnimationFrame(() => this.focus());
  }

  contentSize() {
    return this.showsCrop() ? this.stageBounds() : { width: this.state.output.width, height: this.state.output.height };
  }

  // ------------------------------------------------------------------ render

  scheduleRender() {
    if (this.frame || this.disposed || !this.image) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.paint();
    });
  }

  paint() {
    if (this.disposed || !this.image) return;
    const content = this.contentSize();
    const area = this.stage.getBoundingClientRect();
    const padding = 32;
    const box = {
      width: Math.max(64, area.width - padding),
      height: Math.max(64, area.height - padding),
    };
    const fit = Math.min(1, fit_scale(content.width, content.height, box.width, box.height));
    const factor = this.zoom > 0 ? this.zoom : fit;
    const displayWidth = Math.max(1, Math.round(content.width * factor));
    const displayHeight = Math.max(1, Math.round(content.height * factor));

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const wanted = displayWidth * dpr;
    // Fall back to the full-resolution source only when the preview copy can no
    // longer supply the pixels on screen.
    const previewWidth = this.preview.canvas.width;
    const useFull = this.preview.scale < 1 && wanted > previewWidth * 1.05;
    const source = useFull ? this.image : this.preview.canvas;

    const canvas = render(source, this.state, {
      width: content.width,
      height: content.height,
      scale: wanted / content.width,
      skipCrop: this.showsCrop(),
    });
    canvas.className = "photo-canvas";
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;

    this.holder.style.width = `${displayWidth}px`;
    this.holder.style.height = `${displayHeight}px`;
    const overlayRoot = this.overlay?.root;
    this.holder.replaceChildren(canvas);
    if (overlayRoot) this.holder.appendChild(overlayRoot);

    this.overlay?.setFrame({ left: 0, top: 0, width: displayWidth, height: displayHeight });
    this.overlay?.setRect(this.state.crop);
    this.overlay?.setVisible(this.showsCrop());
    this.stage.classList.toggle("photo-stage-scroll", factor > fit);
    this.updateInfo();
  }

  // ------------------------------------------------------------------- state

  update(mutate, { rebuild = false } = {}) {
    mutate(this.state);
    this.syncDirty();
    if (rebuild) this.renderPanel();
    this.syncFields();
    this.scheduleRender();
  }

  syncDirty() {
    const dirty = !state_is_clean(this.state, this.cropSize());
    if (dirty === this.dirty) return;
    this.dirty = dirty;
    this.onDirty?.(dirty);
  }

  isDirty() {
    return this.dirty;
  }

  // Output tracks the crop until the user types their own dimensions.
  syncOutput() {
    if (this.state.output.custom) return;
    const size = this.cropSize();
    this.state.output.width = size.width;
    this.state.output.height = size.height;
  }

  setAngle(angle) {
    this.update((state) => {
      state.angle = normalize_angle(angle);
      this.syncOutput();
    });
  }

  onCropDrag(rect) {
    this.state.crop = rect;
    this.syncOutput();
    this.updateInfo();
    this.syncFields();
  }

  commitCrop() {
    this.syncOutput();
    this.syncDirty();
    this.syncFields();
    this.scheduleRender();
  }

  setCrop(rect) {
    this.cropApplied = false;
    this.update((state) => {
      state.crop = rect;
      this.syncOutput();
    });
  }

  setAspect(value) {
    this.snapshot();
    const aspect = value === "original" ? this.image.naturalWidth / this.image.naturalHeight : value;
    this.state.aspect = value;
    this.overlay?.setAspect(aspect);
    if (aspect) {
      const bounds = this.stageBounds();
      // Convert the pixel aspect into the normalized space of the stage.
      const normalized = aspect * (bounds.height / bounds.width);
      let width = this.state.crop.width;
      let height = width / normalized;
      if (height > 1) {
        height = 1;
        width = height * normalized;
      }
      if (width > 1) {
        width = 1;
        height = width / normalized;
      }
      const centerX = this.state.crop.x + this.state.crop.width / 2;
      const centerY = this.state.crop.y + this.state.crop.height / 2;
      this.setCrop({
        x: clamp(centerX - width / 2, 0, 1 - width),
        y: clamp(centerY - height / 2, 0, 1 - height),
        width,
        height,
      });
    }
    this.renderPanel();
  }

  // Crop away the transparent wedges an arbitrary rotation leaves behind.
  trimEdges() {
    this.snapshot();
    const bounds = this.stageBounds();
    const inside = inscribed_size(this.image.naturalWidth, this.image.naturalHeight, this.state.angle);
    const width = clamp(inside.width / bounds.width, 0.02, 1);
    const height = clamp(inside.height / bounds.height, 0.02, 1);
    this.setCrop({ x: (1 - width) / 2, y: (1 - height) / 2, width, height });
  }

  setOutput(value, edited) {
    this.snapshot();
    const size = this.cropSize();
    const next = resize_dims({
      width: edited === "width" ? value : this.state.output.width,
      height: edited === "height" ? value : this.state.output.height,
      sourceWidth: size.width,
      sourceHeight: size.height,
      lock: this.state.output.lock,
      edited,
    });
    this.update((state) => {
      state.output.width = next.width;
      state.output.height = next.height;
      state.output.custom = true;
    });
  }

  setOutputPercent(percent) {
    this.snapshot();
    const size = this.cropSize();
    const next = scale_dims(size.width, size.height, percent);
    this.update((state) => {
      state.output.width = next.width;
      state.output.height = next.height;
      state.output.custom = Math.round(percent) !== 100;
    });
  }

  setAdjust(key, value) {
    this.state.adjust[key] = value;
    this.syncDirty();
    this.scheduleRender();
  }

  resetAdjust() {
    this.snapshot();
    this.update((state) => {
      state.adjust = neutral_adjust();
    }, { rebuild: true });
  }

  resetAll() {
    this.snapshot();
    this.update((state) => {
      state.angle = 0;
      state.flipH = false;
      state.flipV = false;
      state.crop = { ...FULL_CROP };
      state.aspect = null;
      state.adjust = neutral_adjust();
      state.output = {
        width: this.image.naturalWidth,
        height: this.image.naturalHeight,
        lock: true,
        custom: false,
      };
    }, { rebuild: true });
    this.overlay?.setAspect(null);
  }

  // --------------------------------------------------------------------- UI

  renderToolbar() {
    const tools = [
      { value: "crop", label: "Crop", icon: CropIcon },
      { value: "rotate", label: "Rotate", icon: RotateRightIcon },
      { value: "resize", label: "Resize", icon: ResizeIcon },
      { value: "color", label: "Color", icon: ColorIcon },
    ];
    this.toolbar.replaceChildren(
      ...tools.map((tool) =>
        h(
          "button",
          {
            type: "button",
            class: cls("photo-tool", this.tool === tool.value && "photo-tool-active"),
            "aria-pressed": String(this.tool === tool.value),
            onClick: () => this.setTool(tool.value),
          },
          tool.icon(),
          h("span", null, tool.label),
        ),
      ),
    );
  }

  setTool(tool) {
    if (this.tool === tool) return;
    if (tool === "crop") this.cropApplied = false;
    this.tool = tool;
    this.renderToolbar();
    this.renderPanel();
    this.scheduleRender();
  }

  renderPanel() {
    this.fields = {};
    if (this.tool === "crop") this.panel.replaceChildren(...this.cropPanel());
    else if (this.tool === "rotate") this.panel.replaceChildren(...this.rotatePanel());
    else if (this.tool === "resize") this.panel.replaceChildren(...this.resizePanel());
    else this.panel.replaceChildren(...this.colorPanel());
    this.syncFields();
  }

  cropPanel() {
    const size = this.cropSize();
    this.fields.cropWidth = number_field({
      label: "Width",
      value: Math.round(size.width),
      suffix: "px",
      onCommit: (value) => this.setCropSize(value, "width"),
    });
    this.fields.cropHeight = number_field({
      label: "Height",
      value: Math.round(size.height),
      suffix: "px",
      onCommit: (value) => this.setCropSize(value, "height"),
    });
    // The number fields snapshot through setCropSize; the angle and colour
    // sliders need the explicit hook because they fire per frame.

    return [
      section(
        "Aspect ratio",
        h(
          "div",
          { class: "photo-chips" },
          ASPECTS.map((item) =>
            h(
              "button",
              {
                type: "button",
                class: cls("photo-chip", this.state.aspect === item.value && "photo-chip-active"),
                onClick: () => this.setAspect(item.value),
              },
              item.label,
            ),
          ),
        ),
        row(
          tool_button("Portrait", null, () => this.swapAspect(), { tooltip: "Swap the ratio's orientation" }),
          tool_button("Trim edges", TrimIcon(), () => this.trimEdges(), {
            tooltip: "Crop to the largest rectangle without transparent corners",
          }),
        ),
      ),
      section("Crop size", row(this.fields.cropWidth, this.fields.cropHeight)),
      section(
        "",
        row(
          this.cropApplied
            ? tool_button("Adjust crop", CropIcon(), () => this.editCrop(), { wide: true })
            : tool_button("Apply crop  ⏎", CheckIcon(), () => this.applyCrop(), { wide: true, primary: true }),
        ),
        row(tool_button("Reset crop", ResetIcon(), () => this.setCrop({ ...FULL_CROP }), { wide: true })),
        h(
          "p",
          { class: "photo-hint" },
          this.cropApplied
            ? "Cropped. Save writes this out — or keep going with Resize and Color."
            : "Drag inside the picture to draw a crop, or drag the handles; arrow keys nudge it. Press Enter (or double-click) to apply, then Save.",
        ),
      ),
    ];
  }

  swapAspect() {
    this.snapshot();
    const value = this.state.aspect;
    if (value === null) return;
    if (value === "original") {
      this.setAspect(this.image.naturalHeight / this.image.naturalWidth);
      return;
    }
    this.setAspect(1 / value);
  }

  setCropSize(value, edited) {
    this.snapshot();
    const bounds = this.stageBounds();
    const crop = { ...this.state.crop };
    if (edited === "width") {
      const width = clamp(value / bounds.width, 0.02, 1);
      crop.x = clamp(crop.x + (crop.width - width) / 2, 0, 1 - width);
      crop.width = width;
    } else {
      const height = clamp(value / bounds.height, 0.02, 1);
      crop.y = clamp(crop.y + (crop.height - height) / 2, 0, 1 - height);
      crop.height = height;
    }
    this.setCrop(crop);
  }

  rotatePanel() {
    this.fields.angle = slider({
      label: "Angle",
      value: this.state.angle,
      min: -180,
      max: 180,
      step: 0.1,
      neutral: 0,
      suffix: "°",
      onBegin: () => this.snapshot(),
      onInput: (value) => this.setAngle(value),
    });

    return [
      section(
        "Straighten",
        this.fields.angle,
        row(
          tool_button("−0.1°", null, () => this.nudgeAngle(-0.1)),
          tool_button("−1°", null, () => this.nudgeAngle(-1)),
          tool_button("+1°", null, () => this.nudgeAngle(1)),
          tool_button("+0.1°", null, () => this.nudgeAngle(0.1)),
        ),
      ),
      section(
        "Quarter turns",
        row(
          tool_button("Rotate left", RotateLeftIcon(), () => this.nudgeAngle(-90), { iconOnly: true, tooltip: "Rotate 90° left" }),
          tool_button("Rotate right", RotateRightIcon(), () => this.nudgeAngle(90), { iconOnly: true, tooltip: "Rotate 90° right" }),
          tool_button("Mirror horizontally", FlipHorizontalIcon(), () => this.flip("flipH"), {
            iconOnly: true,
            active: this.state.flipH,
            tooltip: "Mirror horizontally",
          }),
          tool_button("Mirror vertically", FlipVerticalIcon(), () => this.flip("flipV"), {
            iconOnly: true,
            active: this.state.flipV,
            tooltip: "Mirror vertically",
          }),
        ),
      ),
      section(
        "",
        row(
          tool_button("Trim edges", TrimIcon(), () => this.trimEdges(), { wide: true }),
        ),
        h("p", { class: "photo-hint" }, "Any angle, not just quarter turns. Trim removes the empty corners a tilt leaves behind."),
      ),
    ];
  }

  nudgeAngle(delta) {
    this.snapshot();
    const next = normalize_angle(Math.round((this.state.angle + delta) * 10) / 10);
    this.setAngle(next);
    this.fields.angle?.setValue?.(next);
  }

  flip(key) {
    this.snapshot();
    this.update((state) => {
      state[key] = !state[key];
    }, { rebuild: true });
  }

  resizePanel() {
    const size = this.cropSize();
    const percent = Math.round((this.state.output.width / Math.max(1, size.width)) * 100);
    this.fields.outWidth = number_field({
      label: "Width",
      value: Math.round(this.state.output.width),
      suffix: "px",
      onCommit: (value) => this.setOutput(value, "width"),
    });
    this.fields.outHeight = number_field({
      label: "Height",
      value: Math.round(this.state.output.height),
      suffix: "px",
      onCommit: (value) => this.setOutput(value, "height"),
    });
    this.fields.lock = toggle({
      label: "Keep aspect ratio",
      checked: this.state.output.lock,
      onChange: (checked) => {
        this.snapshot();
        this.state.output.lock = checked;
      },
    });
    this.fields.percent = number_field({
      label: "Scale",
      value: percent,
      min: 1,
      max: 1000,
      suffix: "%",
      onCommit: (value) => this.setOutputPercent(value),
    });

    return [
      section("Output size", row(this.fields.outWidth, this.fields.outHeight), this.fields.lock),
      section(
        "Scale",
        row(this.fields.percent),
        h(
          "div",
          { class: "photo-chips" },
          [25, 50, 75, 100].map((value) =>
            h(
              "button",
              { type: "button", class: "photo-chip", onClick: () => this.setOutputPercent(value) },
              `${value}%`,
            ),
          ),
        ),
      ),
      section(
        "Fit to",
        h(
          "div",
          { class: "photo-chips" },
          [512, 1024, 1920, 2560].map((value) =>
            h(
              "button",
              { type: "button", class: "photo-chip", onClick: () => this.fitLongest(value) },
              `${value}px`,
            ),
          ),
        ),
        h("p", { class: "photo-hint" }, "Scales the cropped picture so its longest side matches."),
      ),
    ];
  }

  fitLongest(longest) {
    this.snapshot();
    const size = this.cropSize();
    const factor = longest / Math.max(size.width, size.height);
    this.setOutputPercent(Math.round(factor * 100 * 100) / 100);
  }

  colorPanel() {
    const sliders = [
      { key: "exposure", label: "Exposure", min: -100, max: 100, step: 1 },
      { key: "brightness", label: "Brightness", min: -100, max: 100, step: 1 },
      { key: "contrast", label: "Contrast", min: -100, max: 100, step: 1 },
      { key: "saturation", label: "Saturation", min: -100, max: 100, step: 1 },
      { key: "vibrance", label: "Vibrance", min: -100, max: 100, step: 1 },
      { key: "temperature", label: "Temperature", min: -100, max: 100, step: 1 },
      { key: "tint", label: "Tint", min: -100, max: 100, step: 1 },
      { key: "hue", label: "Hue", min: -180, max: 180, step: 1, suffix: "°" },
      { key: "gamma", label: "Gamma", min: 0.2, max: 3, step: 0.01, neutral: 1 },
      { key: "sharpen", label: "Sharpen", min: 0, max: 100, step: 1 },
    ];

    return [
      section(
        "Adjustments",
        ...sliders.map((item) =>
          slider({
            label: item.label,
            value: this.state.adjust[item.key],
            min: item.min,
            max: item.max,
            step: item.step,
            neutral: item.neutral ?? 0,
            suffix: item.suffix ?? "",
            onBegin: () => this.snapshot(),
            onInput: (value) => this.setAdjust(item.key, value),
          }),
        ),
      ),
      section(
        "Effects",
        toggle({
          label: "Black & white",
          checked: this.state.adjust.grayscale,
          onChange: (checked) => {
            this.snapshot();
            this.setAdjust("grayscale", checked);
          },
        }),
        toggle({
          label: "Invert",
          checked: this.state.adjust.invert,
          onChange: (checked) => {
            this.snapshot();
            this.setAdjust("invert", checked);
          },
        }),
        row(tool_button("Reset color", ResetIcon(), () => this.resetAdjust(), { wide: true })),
      ),
    ];
  }

  renderFooter() {
    this.info = h("div", { class: "photo-info" });
    this.qualityRow = h("div", { class: "photo-quality" });
    this.saveButton = tool_button("Save", SaveIcon(), () => void this.save(), { wide: true });
    this.copyButton = tool_button("Save a copy", CopyFileIcon(), () => void this.save({ copy: true }), { wide: true });
    this.undoButton = tool_button("Undo", UndoIcon(), () => this.undo(), { iconOnly: true, tooltip: "Undo (⌘Z)" });
    this.redoButton = tool_button("Redo", RedoIcon(), () => this.redo(), { iconOnly: true, tooltip: "Redo (⇧⌘Z)" });

    this.footer.replaceChildren(
      this.info,
      h(
        "div",
        { class: "photo-export" },
        segmented(
          [
            { label: "Original", value: "original" },
            { label: "PNG", value: "image/png" },
            { label: "JPEG", value: "image/jpeg" },
            { label: "WebP", value: "image/webp" },
          ],
          this.format,
          (value) => {
            this.format = value;
            this.renderFooter();
            this.updateInfo();
          },
        ),
        this.qualityRow,
      ),
      h("div", { class: "photo-actions" }, this.saveButton, this.copyButton),
      h(
        "div",
        { class: "photo-history" },
        this.undoButton,
        this.redoButton,
        tool_button("Reset all edits", ResetIcon(), () => this.resetAll(), { wide: true }),
      ),
    );
    this.updateHistoryButtons();

    if (is_lossy_mime(this.exportMime())) {
      this.qualityRow.replaceChildren(
        slider({
          label: "Quality",
          value: this.quality,
          min: 10,
          max: 100,
          step: 1,
          neutral: 92,
          suffix: "%",
          onInput: (value) => {
            this.quality = value;
          },
        }),
      );
    } else {
      this.qualityRow.replaceChildren();
    }
    this.updateInfo();
  }

  updateInfo() {
    if (!this.info || !this.image) return;
    const output = this.state.output;
    const target = this.targetPath();
    const parts = [
      h("span", { class: "photo-info-item" }, `${format_dims(this.image.naturalWidth, this.image.naturalHeight)} → ${format_dims(output.width, output.height)}`),
    ];
    if (this.state.angle !== 0) {
      parts.push(h("span", { class: "photo-info-item" }, `${this.state.angle.toFixed(1)}°`));
    }
    if (target !== this.filePath) {
      parts.push(h("span", { class: "photo-info-item photo-info-note" }, `saves as ${basename(target)}`));
    }
    this.info.replaceChildren(...parts);
  }

  // ------------------------------------------------------------------ saving

  exportMime() {
    if (this.format !== "original") return this.format;
    return is_encodable_image(this.filePath) ? image_mime(this.filePath) : "image/png";
  }

  targetPath() {
    const mime = this.exportMime();
    const ext = ext_for_mime(mime);
    const current = extname(this.filePath);
    if (current === ext) return this.filePath;
    if (mime === "image/jpeg" && current === ".jpeg") return this.filePath;
    return replace_ext(this.filePath, ext);
  }

  async uniqueCopyPath() {
    const ext = ext_for_mime(this.exportMime());
    for (let attempt = 1; attempt < 100; attempt += 1) {
      const candidate = copy_path_candidate(this.filePath, ext, attempt);
      // eslint-disable-next-line no-await-in-loop
      if (!(await path_exists(candidate))) return candidate;
    }
    return copy_path_candidate(this.filePath, ext, Date.now());
  }

  async save({ copy = false } = {}) {
    if (this.saving || !this.image) return false;
    const mime = this.exportMime();
    let target = this.targetPath();
    const overwrites = !copy && target === this.filePath;

    if (copy || (!overwrites && (await path_exists(target)))) {
      target = await this.uniqueCopyPath();
    }

    if (overwrites && !this.overwriteConfirmed) {
      const ok = await confirm_action({
        title: "Overwrite image",
        message: `${basename(this.filePath)} will be replaced with the edited version. This cannot be undone.`,
        confirmLabel: "Overwrite",
      });
      if (!ok) return false;
      this.overwriteConfirmed = true;
    }

    this.saving = true;
    this.setBusy(true);
    try {
      const canvas = render(this.image, this.state, {
        background: mime === "image/jpeg" ? "#ffffff" : null,
      });
      const blob = await canvas_to_blob(canvas, mime, is_lossy_mime(mime) ? this.quality / 100 : undefined);
      const base64 = await blob_to_base64(blob);
      await write_binary_file(target, base64);
      this.lastWriteAt = Date.now();
      if (target === this.filePath) {
        await this.adopt(blob);
      } else {
        await muxy
          .toast({ title: "Photo editor", body: `Saved ${basename(target)}`, variant: "info" })
          .catch(() => undefined);
      }
      return true;
    } catch (err) {
      await muxy
        .dialog.alert({ title: "Save failed", message: error_message(err), style: "critical" })
        .catch(() => undefined);
      return false;
    } finally {
      this.saving = false;
      this.setBusy(false);
    }
  }

  setBusy(busy) {
    this.root.classList.toggle("photo-editor-busy", busy);
    if (this.saveButton) this.saveButton.disabled = busy;
    if (this.copyButton) this.copyButton.disabled = busy;
  }

  // After overwriting the original, continue from the bytes now on disk so a
  // second round of edits does not re-apply the first.
  async adopt(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (this.disposed) return;
      this.image = image;
      this.preview = preview_source(image, PREVIEW_MAX);
      this.state = initial_state(image.naturalWidth, image.naturalHeight);
      this.state.crop = { ...FULL_CROP };
      this.overlay?.setAspect(null);
      this.clearHistory();
      this.syncDirty();
      this.renderPanel();
      this.renderFooter();
      this.scheduleRender();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // The editor shell asks before re-mounting on a `file.changed` event: our own
  // save triggers one, and re-mounting then would throw away the adopted state.
  suppressReload() {
    return Date.now() - this.lastWriteAt < 2000;
  }

  syncFields() {
    if (!this.image) return;
    const cropSize = this.cropSize();
    this.fields.cropWidth?.setValue?.(Math.round(cropSize.width));
    this.fields.cropHeight?.setValue?.(Math.round(cropSize.height));
    this.fields.outWidth?.setValue?.(Math.round(this.state.output.width));
    this.fields.outHeight?.setValue?.(Math.round(this.state.output.height));
    this.fields.percent?.setValue?.(
      Math.round((this.state.output.width / Math.max(1, cropSize.width)) * 100),
    );
    this.fields.angle?.setValue?.(this.state.angle);
  }

  handleKey(event) {
    if (this.disposed || !this.image) return;
    const target = event.target;
    // Text fields keep their own native undo; a focused slider is not one.
    const field = target instanceof HTMLElement ? target.closest("input, textarea, select") : null;
    const isSlider = field instanceof HTMLInputElement && field.type === "range";
    if (field && !isSlider) return;

    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isSlider) return; // Arrow keys belong to the slider itself.
    const key = event.key.toLowerCase();
    if (event.key === "Enter" && this.tool === "crop") this.applyCrop();
    else if (key === "[") this.nudgeAngle(-1);
    else if (key === "]") this.nudgeAngle(1);
    else if (key === "h") this.flip("flipH");
    else if (key === "v") this.flip("flipV");
    else if (key === "c") this.setTool("crop");
    else if (key === "r") this.setTool("rotate");
    else if (key === "s") this.setTool("resize");
    else if (key === "a") this.setTool("color");
    else if (key === "0") this.setZoom(0);
    else if (key === "+" || key === "=") this.stepZoom(1);
    else if (key === "-") this.stepZoom(-1);
    else return;
    event.preventDefault();
  }

  setZoom(zoom) {
    this.zoom = zoom;
    this.scheduleRender();
  }

  stepZoom(direction) {
    const content = this.contentSize();
    const area = this.stage.getBoundingClientRect();
    const fit = Math.min(1, fit_scale(content.width, content.height, area.width - 32, area.height - 32));
    const current = this.zoom > 0 ? this.zoom : fit;
    const steps = direction > 0 ? ZOOM_STEPS : [...ZOOM_STEPS].reverse();
    const next = steps.find((step) => (direction > 0 ? step > current + 0.001 : step < current - 0.001));
    this.setZoom(next ?? current);
  }

  focus() {
    this.overlay?.box?.focus?.({ preventScroll: true });
  }

  updateConfig() {}

  destroy() {
    this.disposed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.onKeyDown);
    this.overlay?.destroy();
    this.overlay = null;
    this.root?.remove();
    this.root = null;
    this.image = null;
    this.preview = null;
  }
}
