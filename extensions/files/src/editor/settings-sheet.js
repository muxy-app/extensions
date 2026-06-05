import { FONT_SIZE_MAX, FONT_SIZE_MIN } from "@/lib/editor-config";
import { cls, h } from "@/lib/dom";

const TAB_SIZES = [2, 4, 8];

export class SettingsSheet {
  constructor({ parent, config, update, onClose }) {
    this.parent = parent;
    this.config = config;
    this.update = update;
    this.onClose = onClose;
    this.tabButtons = new Map();

    this.keyHandler = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      this.onClose();
    };
    window.addEventListener("keydown", this.keyHandler);

    this.fontMinus = h("button", {
      class: "button stepper-btn",
      type: "button",
      onClick: () => this.setFont(this.config.fontSize - 1),
    }, "-");
    this.fontValue = h("span", { class: "stepper-value" });
    this.fontPlus = h("button", {
      class: "button stepper-btn",
      type: "button",
      onClick: () => this.setFont(this.config.fontSize + 1),
    }, "+");
    this.lineNumbers = h("input", {
      id: "cfg-line-numbers",
      type: "checkbox",
      onChange: (event) => this.update({ lineNumbers: event.target.checked }),
    });
    this.wordWrap = h("input", {
      id: "cfg-word-wrap",
      type: "checkbox",
      onChange: (event) => this.update({ wordWrap: event.target.checked }),
    });

    this.overlay = h(
      "div",
      { class: "sheet-overlay", onMouseDown: () => this.onClose() },
      h(
        "div",
        {
          class: "sheet",
          role: "dialog",
          "aria-label": "Editor settings",
          onMouseDown: (event) => event.stopPropagation(),
        },
        h("div", { class: "sheet-header" }, h("span", { class: "sheet-title" }, "Editor settings"), h("button", { class: "button", type: "button", onClick: () => this.onClose() }, "Done")),
        h(
          "div",
          { class: "sheet-row" },
          h("label", { class: "sheet-label" }, "Font size"),
          h("div", { class: "stepper" }, this.fontMinus, this.fontValue, this.fontPlus),
        ),
        h(
          "div",
          { class: "sheet-row" },
          h("label", { class: "sheet-label", for: "cfg-line-numbers" }, "Line numbers"),
          this.lineNumbers,
        ),
        h(
          "div",
          { class: "sheet-row" },
          h("label", { class: "sheet-label", for: "cfg-word-wrap" }, "Word wrap"),
          this.wordWrap,
        ),
        h(
          "div",
          { class: "sheet-row" },
          h("label", { class: "sheet-label" }, "Tab size"),
          h(
            "div",
            { class: "segmented" },
            TAB_SIZES.map((size) => {
              const button = h("button", {
                type: "button",
                onClick: () => this.update({ tabSize: size }),
              }, size);
              this.tabButtons.set(size, button);
              return button;
            }),
          ),
        ),
      ),
    );

    this.parent.appendChild(this.overlay);
    this.syncControls();
  }

  setConfig(config) {
    this.config = config;
    this.syncControls();
  }

  setFont(value) {
    this.update({ fontSize: Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, value)) });
  }

  syncControls() {
    const config = this.config;
    this.fontMinus.disabled = config.fontSize <= FONT_SIZE_MIN;
    this.fontPlus.disabled = config.fontSize >= FONT_SIZE_MAX;
    this.fontValue.textContent = `${config.fontSize}px`;
    this.lineNumbers.checked = Boolean(config.lineNumbers);
    this.wordWrap.checked = Boolean(config.wordWrap);

    for (const [size, button] of this.tabButtons) {
      button.className = cls("segment", config.tabSize === size && "segment-active");
      button.setAttribute("aria-pressed", String(config.tabSize === size));
    }
  }

  destroy() {
    window.removeEventListener("keydown", this.keyHandler);
    this.overlay.remove();
  }
}
