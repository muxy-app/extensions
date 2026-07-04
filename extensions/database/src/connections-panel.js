import "./styles.css";
import { clear, h } from "./lib/dom.js";
import { renderLauncher } from "./connections/screen.js";
import { sweepTunnels } from "./lib/tunnel.js";

const EXT = "database";

function boot(root) {
    if (!window.muxy) {
        clear(root);
        root.appendChild(h("div", { class: "flex h-full items-center justify-center text-muted-foreground" }, "This page must run inside Muxy"));
        return;
    }
    sweepTunnels().catch(() => undefined);
    renderLauncher(root, {
        variant: "panel",
        onOpen: (conn) => {
            muxy.events.emit(`extension.${EXT}.open-connection`, { connectionId: conn.id }).catch(() => undefined);
        },
    });
}

boot(document.getElementById("root"));
