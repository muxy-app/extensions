import { hex_to_rgb, hsv_to_rgb, rgb_to_hex, rgb_to_hsv } from "@/lib/color-convert";

let active = null;

const STYLE_ID = "muxy-color-picker-style";

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.muxy-color-picker {
  position: fixed;
  z-index: 2147483647;
  width: 200px;
  padding: 10px;
  border-radius: 10px;
  /* Guaranteed-opaque background. The Muxy theme's --muxy-surface is
     translucent, which let the editor's code show through the popup. We stack
     the (opaque) editor background as a solid base, then the surface tint on
     top, so the popup is fully opaque in both light and dark themes. */
  background-color: var(--muxy-background, #1e1e22);
  background-image: linear-gradient(var(--muxy-surface, transparent), var(--muxy-surface, transparent));
  border: 1px solid var(--muxy-border, rgba(128,128,128,0.35));
  box-shadow: 0 8px 28px rgba(0,0,0,0.45);
  font: 12px "SF Mono", Menlo, monospace;
  color: var(--muxy-foreground, #ddd);
  user-select: none;
}
.muxy-color-picker__sv {
  position: relative;
  width: 100%;
  height: 120px;
  border-radius: 6px;
  cursor: crosshair;
  overflow: hidden;
}
.muxy-color-picker__sv-sat,
.muxy-color-picker__sv-val {
  position: absolute;
  inset: 0;
  border-radius: 6px;
}
.muxy-color-picker__sv-sat { background: linear-gradient(to right, #fff, rgba(255,255,255,0)); }
.muxy-color-picker__sv-val { background: linear-gradient(to top, #000, rgba(0,0,0,0)); }
.muxy-color-picker__sv-thumb,
.muxy-color-picker__hue-thumb {
  position: absolute;
  width: 12px;
  height: 12px;
  margin: -6px 0 0 -6px;
  border-radius: 50%;
  border: 2px solid var(--muxy-background);
  box-shadow: 0 0 0 1px var(--muxy-border);
  pointer-events: none;
}
.muxy-color-picker__hue {
  position: relative;
  width: 100%;
  height: 12px;
  margin-top: 10px;
  border-radius: 6px;
  cursor: pointer;
  background: linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%);
}
.muxy-color-picker__hue-thumb {
  top: 50%;
  margin-top: -6px;
  border-radius: 4px;
  width: 6px;
  height: 18px;
}
.muxy-color-picker__row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.muxy-color-picker__preview {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  box-shadow: inset 0 0 0 1px var(--muxy-border);
  flex: none;
}
.muxy-color-picker__hex {
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  padding: 4px 6px;
  border-radius: 6px;
  border: 1px solid var(--muxy-border, rgba(128,128,128,0.35));
  background: var(--muxy-background, #141417);
  color: inherit;
  font: inherit;
}
.muxy-color-picker__hex:focus {
  outline: none;
  border-color: var(--muxy-accent, #4796f0);
}`;
  document.head.appendChild(style);
}

function el(cls, tag = "div") {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

class ColorPicker {
  constructor({ anchorRect, hex, onChange, onClose }) {
    this.onChange = onChange;
    this.onClose = onClose;
    this.alpha = 1;

    const rgb = hex_to_rgb(hex) ?? { r: 255, g: 0, b: 0, a: 1 };
    this.alpha = rgb.a;
    const hsv = rgb_to_hsv(rgb.r, rgb.g, rgb.b);
    this.h = hsv.h;
    this.s = hsv.s;
    this.v = hsv.v;

    this.build();
    this.position(anchorRect);
    this.syncUI();

    this.onDocPointer = (event) => {
      if (!this.root.contains(event.target)) this.close();
    };
    this.onKey = (event) => {
      if (event.key === "Escape") this.close();
    };
    setTimeout(() => {
      document.addEventListener("mousedown", this.onDocPointer, true);
      document.addEventListener("keydown", this.onKey, true);
    }, 0);
  }

  build() {
    ensureStyles();
    this.root = el("muxy-color-picker");

    this.sv = el("muxy-color-picker__sv");
    this.svHueLayer = el("muxy-color-picker__sv-hue", "div");
    this.svHueLayer.style.position = "absolute";
    this.svHueLayer.style.inset = "0";
    this.svHueLayer.style.borderRadius = "6px";
    this.sv.appendChild(this.svHueLayer);
    this.sv.appendChild(el("muxy-color-picker__sv-sat"));
    this.sv.appendChild(el("muxy-color-picker__sv-val"));
    this.svThumb = el("muxy-color-picker__sv-thumb");
    this.sv.appendChild(this.svThumb);

    this.hue = el("muxy-color-picker__hue");
    this.hueThumb = el("muxy-color-picker__hue-thumb");
    this.hue.appendChild(this.hueThumb);

    const row = el("muxy-color-picker__row");
    this.preview = el("muxy-color-picker__preview");
    this.hexInput = el("muxy-color-picker__hex", "input");
    this.hexInput.type = "text";
    this.hexInput.spellcheck = false;
    this.hexInput.setAttribute("autocapitalize", "off");
    this.hexInput.setAttribute("autocomplete", "off");
    this.hexInput.setAttribute("autocorrect", "off");
    row.appendChild(this.preview);
    row.appendChild(this.hexInput);

    this.root.appendChild(this.sv);
    this.root.appendChild(this.hue);
    this.root.appendChild(row);
    document.body.appendChild(this.root);

    this.bindSV();
    this.bindHue();
    this.bindHex();
    this.root.addEventListener("mousedown", (event) => event.stopPropagation());
  }

  position(rect) {
    const margin = 6;
    const width = 200 + 22;
    const height = 200;
    let left = rect.left;
    let top = rect.bottom + margin;
    if (top + height > window.innerHeight) top = rect.top - height - margin;
    if (top < margin) top = margin;
    left = Math.max(margin, Math.min(left, window.innerWidth - width));
    this.root.style.left = `${left}px`;
    this.root.style.top = `${top}px`;
  }

  bindSV() {
    const onMove = (event) => {
      const r = this.sv.getBoundingClientRect();
      this.s = clamp01((event.clientX - r.left) / r.width);
      this.v = 1 - clamp01((event.clientY - r.top) / r.height);
      this.emit();
    };
    drag(this.sv, onMove);
  }

  bindHue() {
    const onMove = (event) => {
      const r = this.hue.getBoundingClientRect();
      this.h = clamp01((event.clientX - r.left) / r.width) * 360;
      this.emit();
    };
    drag(this.hue, onMove);
  }

  bindHex() {
    this.hexInput.addEventListener("input", () => {
      const value = normalizeHexInput(this.hexInput.value);
      if (!value) return;
      const rgb = hex_to_rgb(value);
      if (!rgb) return;
      this.alpha = rgb.a;
      const hsv = rgb_to_hsv(rgb.r, rgb.g, rgb.b);
      this.h = hsv.h;
      this.s = hsv.s;
      this.v = hsv.v;
      this.syncUI(true);
      this.onChange(this.currentHex());
    });
  }

  currentHex() {
    const { r, g, b } = hsv_to_rgb(this.h, this.s, this.v);
    return rgb_to_hex(r, g, b, this.alpha);
  }

  emit() {
    this.syncUI();
    this.onChange(this.currentHex());
  }

  syncUI(skipHexField = false) {
    const hex = this.currentHex();
    const opaque = hex.slice(0, 7);
    this.svHueLayer.style.background = `hsl(${this.h}, 100%, 50%)`;
    this.svThumb.style.left = `${this.s * 100}%`;
    this.svThumb.style.top = `${(1 - this.v) * 100}%`;
    this.hueThumb.style.left = `${(this.h / 360) * 100}%`;
    this.preview.style.background = opaque;
    if (!skipHexField && document.activeElement !== this.hexInput) {
      this.hexInput.value = opaque;
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    document.removeEventListener("mousedown", this.onDocPointer, true);
    document.removeEventListener("keydown", this.onKey, true);
    this.root.remove();
    if (active === this) active = null;
    this.onClose?.();
  }
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function normalizeHexInput(raw) {
  let v = raw.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]+$/.test(v)) return null;
  if (![3, 4, 6, 8].includes(v.length)) return null;
  return `#${v}`;
}

function drag(track, onMove) {
  track.addEventListener("mousedown", (event) => {
    event.preventDefault();
    onMove(event);
    const move = (e) => onMove(e);
    const up = () => {
      document.removeEventListener("mousemove", move, true);
      document.removeEventListener("mouseup", up, true);
    };
    document.addEventListener("mousemove", move, true);
    document.addEventListener("mouseup", up, true);
  });
}

export function openColorPicker(options) {
  active?.close();
  active = new ColorPicker(options);
  return active;
}

export function closeColorPicker() {
  active?.close();
}
