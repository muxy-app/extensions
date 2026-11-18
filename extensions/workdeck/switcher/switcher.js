/* Popover behind the top bar button: lists every sidebar that can be active and switches to the chosen one. */
const $ = (s) => document.querySelector(s);
const errBox = $("#err");

/* muxy.popover only exists when the page runs inside the top bar popover. */
const inPopover = () => !!muxy.popover;

function fit() {
  if (inPopover()) Promise.resolve(muxy.popover.resize(300, Math.min(420, Math.max(120, document.body.scrollHeight + 14)))).catch(() => {});
}

function showError(e) {
  errBox.hidden = false;
  errBox.textContent = tr("전환하지 못했어요: {0}", String((e && e.message) || e));
  fit();
}

async function render() {
  const box = $("#items");
  try {
    const { items, current } = await listSidebars();
    box.replaceChildren(...items.map((it) => {
      const b = document.createElement("button");
      b.className = "item" + (it.id === current ? " on" : "");
      const check = document.createElement("span"); check.className = "check"; check.textContent = it.id === current ? "✓" : "";
      const t = document.createElement("span"); t.className = "t";
      const name = document.createElement("b"); name.textContent = it.title;
      const sub = document.createElement("small"); sub.textContent = it.subtitle;
      t.append(name, sub); b.append(check, t);
      b.addEventListener("click", async () => {
        if (it.id === current) { if (inPopover()) muxy.popover.close(); return; }
        box.querySelectorAll("button").forEach((x) => { x.disabled = true; });
        try { await setActiveSidebar(it.id); if (inPopover()) muxy.popover.close(); } catch (e) { showError(e); box.querySelectorAll("button").forEach((x) => { x.disabled = false; }); }
      });
      return b;
    }));
  } catch (e) {
    box.replaceChildren();
    showError(e);
  }
  fit();
}

render();
