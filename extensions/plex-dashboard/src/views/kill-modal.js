import { el } from "./dom.js";

export function killModalView({ session, defaultMessage, onConfirm, onCancel }) {
  const textarea = el("textarea", {
    rows: 3,
    placeholder: "Optional message shown to the viewer (e.g. \"Pausing for maintenance, back in 10 min\")",
    value: defaultMessage || "",
  });
  const busy = el("p", { class: "muted", style: { display: "none" } }, "Stopping…");
  const err = el("p", { class: "error", style: { display: "none" } });

  const stopBtn = el(
    "button",
    {
      class: "danger",
      onClick: async () => {
        stopBtn.disabled = true;
        cancelBtn.disabled = true;
        busy.style.display = "block";
        err.style.display = "none";
        try {
          await onConfirm(textarea.value);
        } catch (e) {
          busy.style.display = "none";
          err.style.display = "block";
          err.textContent = e?.message || String(e);
          stopBtn.disabled = false;
          cancelBtn.disabled = false;
        }
      },
    },
    "Stop stream",
  );

  const cancelBtn = el("button", { onClick: onCancel }, "Cancel");

  return el(
    "div",
    { class: "modal-backdrop", onClick: (e) => { if (e.target === e.currentTarget) onCancel(); } },
    el(
      "div",
      { class: "modal", role: "dialog", "aria-modal": "true" },
      el("h2", null, "Stop stream"),
      el(
        "p",
        null,
        "Stop ",
        el("strong", null, session.title),
        " for ",
        el("strong", null, session.user),
        " on ",
        el("strong", null, session.device),
        "?",
      ),
      textarea,
      busy,
      err,
      el("div", { class: "actions" }, cancelBtn, stopBtn),
    ),
  );
}
