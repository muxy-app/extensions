import { el } from "./dom.js";

export function confirmSignOutView({ onConfirm, onCancel }) {
  const cancelBtn = el("button", { onClick: onCancel }, "Cancel");
  const confirmBtn = el(
    "button",
    { class: "danger", onClick: onConfirm },
    "Sign out",
  );

  return el(
    "div",
    {
      class: "modal-backdrop",
      onClick: (e) => {
        if (e.target === e.currentTarget) onCancel();
      },
    },
    el(
      "div",
      { class: "modal", role: "dialog", "aria-modal": "true" },
      el("h2", null, "Sign out of Plex?"),
      el(
        "p",
        null,
        "You'll need to sign in again to view your server.",
      ),
      el("div", { class: "actions" }, cancelBtn, confirmBtn),
    ),
  );
}
