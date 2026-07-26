import "./styles.css";
import { createRoot } from "react-dom/client";
import { ConnectionsScreen } from "./connections/connections-screen.jsx";
import { sweepTunnels } from "./lib/tunnel.js";

const EXT = "database";

function Root() {
    if (!window.muxy)
        return <div className="flex h-full items-center justify-center text-muted-foreground">This page must run inside Muxy</div>;
    return (
        <ConnectionsScreen
            variant="panel"
            onOpen={(conn) => muxy.events.emit(`extension.${EXT}.open-connection`, { connectionId: conn.id }).catch(() => undefined)}
        />
    );
}

if (window.muxy)
    sweepTunnels().catch(() => undefined);

createRoot(document.getElementById("root")).render(<Root />);
