// A key/value table (params, headers, form fields, environment variables).
// It edits `rows` in place and calls onChange after every edit. The last row
// is always an empty one: typing in it adds a row.
import { esc } from "./ui.js";
import { icon } from "./icons.js";

function toBulk(rows) {
  return rows.map((r) => `${r.enabled === false ? "// " : ""}${r.key}: ${r.value}`).join("\n");
}

function fromBulk(text) {
  const rows = [];
  for (const raw of String(text).split("\n")) {
    let line = raw.trim();
    if (!line) continue;
    let enabled = true;
    if (line.startsWith("//")) {
      enabled = false;
      line = line.slice(2).trim();
    }
    const i = line.indexOf(":");
    rows.push({ key: (i < 0 ? line : line.slice(0, i)).trim(), value: i < 0 ? "" : line.slice(i + 1).replace(/^ /, ""), enabled });
  }
  return rows;
}

export function mountKv(host, opts) {
  const {
    rows,
    onChange = () => {},
    keyPlaceholder = "Key",
    valuePlaceholder = "Value",
    types = false,
    keyList = "",
    valueList = "",
    bulk = true,
    note = "",
  } = opts;
  let bulkMode = false;

  const rowHtml = (r, i) => {
    const ghost = r == null;
    const row = r || { key: "", value: "", enabled: true, type: "text" };
    const file = types && row.type === "file";
    return `<div class="kv-row${ghost ? " ghost" : ""}${!ghost && row.enabled === false ? " off" : ""}" data-i="${ghost ? "new" : i}">
      <span class="kv-check">${ghost ? "" : `<input type="checkbox" class="kv-on"${row.enabled !== false ? " checked" : ""} title="Include">`}</span>
      <input class="kv-key" value="${esc(row.key)}" placeholder="${esc(ghost ? `Add ${keyPlaceholder.toLowerCase()}` : keyPlaceholder)}" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off"${keyList ? ` list="${keyList}"` : ""}>
      ${types ? `<select class="kv-type"${ghost ? " disabled" : ""}><option value="text"${!file ? " selected" : ""}>Text</option><option value="file"${file ? " selected" : ""}>File</option></select>` : ""}
      <input class="kv-val" value="${esc(row.value)}" placeholder="${esc(file ? "path/in/project" : valuePlaceholder)}" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off"${valueList && !file ? ` list="${valueList}"` : ""}>
      ${ghost ? "<span></span>" : `<button class="icon-btn kv-del" title="Remove" aria-label="Remove">${icon("x")}</button>`}
    </div>`;
  };

  const render = () => {
    const enabled = rows.filter((r) => r.enabled !== false && r.key).length;
    const tools = `<div class="kv-tools"><span class="kv-note">${note ? esc(note) : rows.length ? `${enabled} of ${rows.length} on` : ""}</span>${
      bulk ? `<button class="link-btn" data-kv="bulk">${bulkMode ? "Table" : "Bulk Edit"}</button>` : ""
    }</div>`;
    if (bulkMode) {
      host.innerHTML = `${tools}<textarea class="kv-bulk" spellcheck="false" placeholder="key: value&#10;// key: value (off)">${esc(toBulk(rows))}</textarea>`;
      return;
    }
    host.innerHTML = `${tools}<div class="kv${types ? " typed" : ""}">${rows.map(rowHtml).join("")}${rowHtml(null)}</div>`;
  };

  const updateNote = () => {
    const n = host.querySelector(".kv-note");
    if (n && !note) {
      const enabled = rows.filter((r) => r.enabled !== false && r.key).length;
      n.textContent = rows.length ? `${enabled} of ${rows.length} on` : "";
    }
  };

  host.addEventListener("input", (e) => {
    const t = e.target;
    if (t.classList.contains("kv-bulk")) {
      rows.splice(0, rows.length, ...fromBulk(t.value).map((r) => (types ? { ...r, type: "text" } : r)));
      onChange(rows);
      return;
    }
    const rowEl = t.closest(".kv-row");
    if (!rowEl) return;
    const field = t.classList.contains("kv-key") ? "key" : t.classList.contains("kv-val") ? "value" : null;
    if (!field) return;
    if (rowEl.dataset.i === "new") {
      const row = { key: "", value: "", enabled: true };
      if (types) row.type = "text";
      row[field] = t.value;
      rows.push(row);
      const caret = t.selectionStart;
      render();
      const el = host.querySelector(`.kv-row[data-i="${rows.length - 1}"] .${field === "key" ? "kv-key" : "kv-val"}`);
      if (el) {
        el.focus({ preventScroll: true });
        el.setSelectionRange(caret, caret);
      }
      onChange(rows);
      return;
    }
    const row = rows[Number(rowEl.dataset.i)];
    if (!row) return;
    row[field] = t.value;
    updateNote();
    onChange(rows);
  });

  host.addEventListener("change", (e) => {
    const t = e.target;
    const rowEl = t.closest(".kv-row");
    const row = rowEl && rows[Number(rowEl.dataset.i)];
    if (!row) return;
    if (t.classList.contains("kv-on")) {
      row.enabled = t.checked;
      rowEl.classList.toggle("off", !t.checked);
      updateNote();
      onChange(rows);
    } else if (t.classList.contains("kv-type")) {
      row.type = t.value === "file" ? "file" : "text";
      render();
      onChange(rows);
    }
  });

  host.addEventListener("click", (e) => {
    const del = e.target.closest(".kv-del");
    if (del) {
      const i = Number(del.closest(".kv-row").dataset.i);
      rows.splice(i, 1);
      render();
      onChange(rows);
      return;
    }
    if (e.target.closest('[data-kv="bulk"]')) {
      bulkMode = !bulkMode;
      render();
      if (bulkMode) host.querySelector(".kv-bulk")?.focus({ preventScroll: true });
    }
  });

  host.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.metaKey || e.ctrlKey) return;
    const t = e.target;
    const rowEl = t.closest?.(".kv-row");
    if (!rowEl) return;
    e.preventDefault();
    if (t.classList.contains("kv-key")) {
      rowEl.querySelector(".kv-val")?.focus({ preventScroll: true });
    } else if (t.classList.contains("kv-val")) {
      const next = rowEl.nextElementSibling;
      next?.querySelector(".kv-key")?.focus({ preventScroll: true });
    }
  });

  render();
  return {
    render,
    focusFirst() {
      host.querySelector(".kv-key")?.focus({ preventScroll: true });
    },
  };
}
