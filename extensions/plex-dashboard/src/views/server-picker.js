import { el } from "./dom.js";

export function serverPickerView({ servers, onPick }) {
  return el(
    "section",
    { class: "view view-picker" },
    el("header", null, el("h1", null, "Pick a server")),
    el(
      "div",
      { class: "card" },
      el(
        "p",
        { class: "muted" },
        servers.length === 0
          ? "No owned Plex Media Servers were found on your account."
          : "Choose which server to monitor. You can switch later by signing out and back in.",
      ),
      el(
        "ul",
        { class: "server-list" },
        servers.map((s) =>
          el(
            "li",
            null,
            el(
              "button",
              {
                class: "row",
                onClick: () => onPick(s),
              },
              el("span", { class: "name" }, s.name),
              el(
                "span",
                { class: "meta muted" },
                [s.productVersion, s.platform].filter(Boolean).join(" · "),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
