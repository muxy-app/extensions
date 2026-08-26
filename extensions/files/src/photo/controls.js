import { cls, h } from "@/lib/dom";

// Small control kit shared by the photo editor's sidebar. Everything sticks to
// the Muxy sizing scale and theme variables.

export function section(title, ...children) {
  return h(
    "section",
    { class: "photo-section" },
    title ? h("h2", { class: "photo-section-title" }, title) : null,
    ...children,
  );
}

export function row(...children) {
  return h("div", { class: "photo-row" }, ...children);
}

export function tool_button(label, icon, onClick, opts = {}) {
  return h(
    "button",
    {
      type: "button",
      class: cls(
        "photo-button",
        opts.active && "photo-button-active",
        opts.wide && "photo-button-wide",
        opts.primary && "photo-button-primary",
      ),
      title: opts.tooltip ?? label,
      "aria-label": opts.tooltip ?? label,
      "aria-pressed": opts.active === undefined ? null : String(Boolean(opts.active)),
      disabled: opts.disabled === true,
      onClick,
    },
    icon ?? null,
    opts.iconOnly ? null : h("span", { class: "photo-button-label" }, label),
  );
}

export function segmented(items, value, onSelect) {
  return h(
    "div",
    { class: "photo-segmented", role: "tablist" },
    items.map((item) =>
      h(
        "button",
        {
          type: "button",
          role: "tab",
          class: cls("photo-segment", item.value === value && "photo-segment-active"),
          "aria-selected": String(item.value === value),
          title: item.tooltip ?? item.label,
          onClick: () => onSelect(item.value),
        },
        item.label,
      ),
    ),
  );
}

/**
 * Labelled slider with a live numeric field. Both stay in sync, the field
 * accepts values typed to the same precision as the slider step, and a
 * double-click on the label snaps back to the neutral value.
 */
export function slider({ label, value, min, max, step = 1, neutral = 0, suffix = "", onInput, onCommit, onBegin }) {
  const range = h("input", {
    type: "range",
    class: "photo-slider",
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
    "aria-label": label,
  });
  const number = h("input", {
    type: "number",
    class: "photo-number photo-number-compact",
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
    "aria-label": `${label} value`,
  });

  // `onBegin` fires once per interaction (a whole drag, not every frame) so the
  // undo history gets one entry per gesture.
  let interacting = false;
  const begin = () => {
    if (interacting) return;
    interacting = true;
    onBegin?.();
  };
  const end = () => {
    interacting = false;
  };

  const push = (next, commit) => {
    const clamped = Math.min(max, Math.max(min, Number(next)));
    if (Number.isNaN(clamped)) return;
    range.value = String(clamped);
    number.value = String(clamped);
    onInput?.(clamped);
    if (commit) onCommit?.(clamped);
  };

  const VALUE_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"];
  range.addEventListener("pointerdown", begin);
  range.addEventListener("keydown", (event) => {
    // Only keys that actually move the slider start an edit — ⌘Z on a focused
    // slider is an undo, not the beginning of a new one.
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (VALUE_KEYS.includes(event.key)) begin();
  });
  range.addEventListener("pointerup", end);
  range.addEventListener("keyup", end);
  range.addEventListener("blur", end);
  range.addEventListener("input", () => {
    begin();
    push(range.value, false);
  });
  range.addEventListener("change", () => {
    push(range.value, true);
    end();
  });
  number.addEventListener("change", () => {
    begin();
    push(number.value, true);
    end();
  });

  const labelNode = h(
    "button",
    {
      type: "button",
      class: "photo-slider-label",
      title: `${label} — click to reset`,
      onClick: () => {
        begin();
        push(neutral, true);
        end();
      },
    },
    label,
  );

  const control = h(
    "div",
    { class: "photo-slider-row" },
    h("div", { class: "photo-slider-head" }, labelNode, h("div", { class: "photo-slider-value" }, number, suffix ? h("span", { class: "photo-unit" }, suffix) : null)),
    range,
  );

  control.setValue = (next) => {
    range.value = String(next);
    number.value = String(next);
  };
  return control;
}

export function number_field({ label, value, min = 1, max = 100000, step = 1, suffix = "", onCommit, onBegin }) {
  const input = h("input", {
    type: "number",
    class: "photo-number",
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
    "aria-label": label,
  });
  const commit = () => {
    onBegin?.();
    onCommit?.(Number(input.value));
  };
  input.addEventListener("change", commit);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
  });

  const field = h(
    "label",
    { class: "photo-field" },
    h("span", { class: "photo-field-label" }, label),
    h("span", { class: "photo-field-input" }, input, suffix ? h("span", { class: "photo-unit" }, suffix) : null),
  );
  field.setValue = (next) => {
    input.value = String(next);
  };
  return field;
}

export function toggle({ label, checked, onChange }) {
  const input = h("input", { type: "checkbox", class: "photo-checkbox", checked });
  input.addEventListener("change", () => onChange?.(input.checked));
  const node = h("label", { class: "photo-toggle" }, input, h("span", null, label));
  node.setValue = (next) => {
    input.checked = Boolean(next);
  };
  return node;
}
