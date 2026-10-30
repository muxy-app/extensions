// The settings webview modal. Self-contained: reads `config` from storage,
// saves on change, and pushes the new value to the background over
// `extension.mon.config` — no result is returned to the opener.
import { h, clear } from "@/lib/dom";
import { normalizeConfig } from "@/format.mjs";
import "./style.css";

const SECTIONS = [
  ["cpu", "CPU"],
  ["gpu", "GPU"],
  ["mem", "Memory"],
  ["net", "Network"],
  ["power", "Power"],
  ["disk", "Disk"],
  ["top", "Top processes"],
];

let config = normalizeConfig(null);
const root = document.getElementById("root");

init();

async function init() {
  try {
    config = normalizeConfig(await muxy.storage.get("config"));
  } catch (error) {
    console.warn("system-monitor: settings config read failed, showing defaults", error);
  }
  render();
  root.querySelector("select")?.focus(); // the modal page owns its own keyboard focus
}

function render() {
  clear(root);
  const t = config.thresholds;
  root.append(
    h(
      "header",
      null,
      h("span", { class: "title" }, "System Monitor"),
      h("button", { class: "done", type: "button", onclick: () => muxy.lifecycle.close() }, "Done"),
    ),
    field("Interval", select(
      [["1", "1s"], ["2", "2s"], ["3", "3s"], ["5", "5s"], ["10", "10s"]],
      String(config.fastSec),
      (v) => save({ fastSec: Number(v) }),
    )),
    field("Status bar", textInput(config.template, (v) => save({ template: v }))),
    h("div", { class: "note" }, "Tokens: {cpu} {gpu} {mem} {memPct} {down} {up} {batt} {load1}"),
    field("CPU warn %", numInput(t.cpu, (v) => save({ thresholds: { ...t, cpu: v } }))),
    field("Mem warn %", numInput(t.mem, (v) => save({ thresholds: { ...t, mem: v } }))),
    field("Disk warn %", numInput(t.disk, (v) => save({ thresholds: { ...t, disk: v } }))),
    field("Notify on warning", checkbox(t.notify, (v) => save({ thresholds: { ...t, notify: v } }))),
    h("div", { class: "group-label" }, "Popover sections"),
    h(
      "div",
      { class: "grid" },
      SECTIONS.map(([key, label]) =>
        h(
          "label",
          { class: "check" },
          checkbox(config.sections[key], (v) => save({ sections: { ...config.sections, [key]: v } })),
          label,
        ),
      ),
    ),
  );
}

async function save(patch) {
  config = normalizeConfig({ ...config, ...patch });
  try {
    await muxy.storage.set("config", config);
    await muxy.events.emit("extension.mon.config", config);
  } catch (error) {
    console.warn("system-monitor: config save failed", error);
  }
  render(); // reflect clamped values
}

function field(label, control) {
  return h("label", { class: "field" }, h("span", null, label), control);
}

function select(options, value, onChange) {
  const el = h(
    "select",
    { onchange: () => onChange(el.value) },
    options.map(([v, label]) => h("option", { value: v, selected: v === value ? "" : null }, label)),
  );
  return el;
}

function textInput(value, onChange) {
  const el = h("input", { type: "text", value, onchange: () => onChange(el.value) });
  return el;
}

function numInput(value, onChange) {
  const el = h("input", {
    type: "number", min: "50", max: "100", value: String(value),
    onchange: () => onChange(Number(el.value)),
  });
  return el;
}

function checkbox(checked, onChange) {
  const el = h("input", { type: "checkbox", onchange: () => onChange(el.checked) });
  el.checked = checked;
  return el;
}
