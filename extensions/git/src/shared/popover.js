import { cls, fill, h } from "@/shared/dom";
import { icon } from "@/shared/icons";
import { closeMenu } from "@/shared/menu";

let current = null;

export function closePopover() {
  current?.close();
}

function place(el, anchor) {
  const rect = anchor.getBoundingClientRect();
  const margin = 6;
  const width = Math.min(innerWidth - margin * 2, Math.max(240, rect.width));
  el.style.width = `${width}px`;
  el.style.left = `${Math.max(margin, Math.min(rect.left, innerWidth - width - margin))}px`;
  el.style.top = `${Math.min(rect.bottom + 4, innerHeight - 120)}px`;
  el.style.maxHeight = `${Math.max(160, innerHeight - rect.bottom - 16)}px`;
}

function mount(anchor, content, onClose) {
  closePopover();
  closeMenu();
  const el = h("div", { class: "popover", role: "dialog" }, content);
  document.body.appendChild(el);
  place(el, anchor);
  const onPointer = (event) => {
    if (!el.contains(event.target) && !anchor.contains(event.target)) state.close();
  };
  const onBlur = () => state.close();
  const state = {
    el,
    anchor,
    close() {
      if (current !== state) return;
      current = null;
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("blur", onBlur);
      el.remove();
      onClose?.();
    },
  };
  window.addEventListener("pointerdown", onPointer, true);
  window.addEventListener("blur", onBlur);
  current = state;
  return state;
}

export function openPicker({ anchor, placeholder, load, cached = null, filter, onPick, rowActions = null, emptyLabel = "Nothing here", footer = null }) {
  if (current?.anchor === anchor) return closePopover();
  let items = cached ?? [];
  let rows = [];
  let active = 0;
  let loading = !cached;
  const input = h("input", { class: "popover-input", placeholder, spellcheck: "false", autocomplete: "off" });
  const list = h("div", { class: "popover-list", role: "listbox" });
  const state = mount(anchor, [h("div", { class: "popover-search" }, icon("search", 13), input), list, footer]);

  const render = () => {
    rows = filter(items, input.value.trim());
    active = Math.min(active, Math.max(0, rows.length - 1));
    if (!rows.length) {
      fill(list, h("div", { class: "popover-empty" }, loading ? icon("loader", 14, "spin") : emptyLabel));
      return;
    }
    fill(
      list,
      rows.map((row, index) =>
        row.header
          ? h("div", { class: "popover-header" }, row.header)
          : h(
              "div",
              { class: cls("popover-row", index === active && "popover-row-active", row.disabled && "popover-row-disabled"), dataset: { index: String(index) }, title: row.title },
              row.icon ? h("span", { class: "popover-icon" }, icon(row.icon, 13)) : null,
              h("span", { class: "popover-text" }, h("span", { class: "popover-title" }, row.label), row.detail ? h("span", { class: "popover-detail" }, row.detail) : null),
              row.trailing ? h("span", { class: "popover-trailing" }, row.trailing) : null,
              rowActions
                ? h(
                    "span",
                    { class: "popover-actions" },
                    rowActions(row).map((action) => h("button", { type: "button", class: "icon-btn icon-btn-sm", title: action.title, dataset: { action: action.id } }, icon(action.icon, 13))),
                  )
                : null,
            ),
      ),
    );
    list.querySelector(".popover-row-active")?.scrollIntoView({ block: "nearest" });
  };

  const pickable = (index) => rows[index] && !rows[index].header && !rows[index].disabled;
  const move = (step) => {
    if (!rows.length) return;
    let next = active;
    for (let i = 0; i < rows.length; i += 1) {
      next = (next + step + rows.length) % rows.length;
      if (pickable(next)) break;
    }
    active = next;
    render();
  };
  const choose = (index) => {
    if (!pickable(index)) return;
    const row = rows[index];
    state.close();
    onPick(row);
  };

  input.addEventListener("input", () => {
    active = 0;
    render();
    if (!pickable(active)) move(1);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(active);
    } else if (event.key === "Escape") {
      event.preventDefault();
      state.close();
      anchor.focus?.();
    }
  });
  list.addEventListener("pointermove", (event) => {
    const index = Number(event.target.closest?.(".popover-row")?.dataset.index);
    if (Number.isFinite(index) && index !== active && pickable(index)) {
      active = index;
      for (const node of list.querySelectorAll(".popover-row")) node.classList.toggle("popover-row-active", Number(node.dataset.index) === index);
    }
  });
  list.addEventListener("click", (event) => {
    const node = event.target.closest?.(".popover-row");
    if (!node) return;
    const index = Number(node.dataset.index);
    const actionId = event.target.closest?.("[data-action]")?.dataset.action;
    if (actionId) {
      const action = rowActions?.(rows[index]).find((a) => a.id === actionId);
      state.close();
      action?.run(rows[index]);
      return;
    }
    choose(index);
  });

  render();
  if (!pickable(active)) move(1);
  input.focus();
  Promise.resolve(load?.())
    .then((fresh) => {
      if (!fresh || current !== state) return;
      items = fresh;
      loading = false;
      render();
      if (!pickable(active)) move(1);
    })
    .catch(() => {
      loading = false;
      if (current === state) render();
    });
  return state;
}

export function openInput({ anchor, title, detail = "", placeholder = "", value = "", confirm = "OK", allowEmpty = false, validate = null, onSubmit }) {
  if (current?.anchor === anchor) return closePopover();
  const input = h("input", { class: "field", placeholder, value, spellcheck: "false", autocomplete: "off" });
  const error = h("div", { class: "popover-error", hidden: true });
  const submit = h("button", { type: "button", class: "btn btn-primary" }, confirm);
  const cancel = h("button", { type: "button", class: "btn" }, "Cancel");
  const state = mount(
    anchor,
    h(
      "div",
      { class: "popover-form" },
      h("div", { class: "popover-form-title" }, title),
      detail ? h("div", { class: "popover-form-detail" }, detail) : null,
      input,
      error,
      h("div", { class: "popover-form-actions" }, cancel, submit),
    ),
  );
  const check = async () => {
    const text = input.value.trim();
    const problem = !text && !allowEmpty ? "Required" : (text && (await validate?.(text))) || "";
    error.textContent = problem;
    error.hidden = !problem;
    return problem ? null : text;
  };
  const send = async () => {
    const text = await check();
    if (text === null) return;
    state.close();
    onSubmit(text);
  };
  submit.addEventListener("click", () => void send());
  cancel.addEventListener("click", () => state.close());
  input.addEventListener("input", () => {
    error.hidden = true;
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void send();
    } else if (event.key === "Escape") {
      event.preventDefault();
      state.close();
    }
  });
  input.focus();
  input.select();
  return state;
}

export function openConfirm({ anchor, title, message = "", buttons, critical = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const nodes = buttons.map((label, index) => {
      const primary = index === 0 && !critical;
      const danger = index === 0 && critical;
      const choose = () => {
        done(label);
        state.close();
      };
      return h("button", { type: "button", class: cls("btn", primary && "btn-primary", danger && "btn-danger-solid"), onclick: choose }, label);
    });
    const cancel = h("button", { type: "button", class: "btn", onclick: () => state.close() }, buttons.length ? "Cancel" : "OK");
    const content = h(
      "div",
      { class: "popover-form popover-confirm", tabindex: "-1" },
      h("div", { class: "popover-form-title" }, title),
      message ? h("div", { class: "popover-message" }, message) : null,
      h("div", { class: "popover-form-actions" }, cancel, ...nodes.reverse()),
    );
    const state = mount(anchor, content, () => done(null));
    content.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      state.close();
    });
    (critical || !nodes.length ? cancel : nodes[nodes.length - 1]).focus();
  });
}
