import { useState } from "react";
import { Icon } from "../ui/icon.jsx";
import { toast } from "../ui/toast.js";
import { parseConnectionUrl, saveConnection } from "../lib/connections.js";
import { setSessionPassword, storePassword, hasKeychain } from "../lib/credentials.js";

export function ImportRow({ onImported }) {
    const [value, setValue] = useState("");

    const importIt = async () => {
        const parsed = parseConnectionUrl(value);
        if (!parsed) {
            toast("Could not parse that URL", "warning");
            return;
        }
        const { conn, password } = parsed;
        if (password) {
            if (await hasKeychain()) {
                await storePassword(conn.id, password);
                conn.keychain = true;
            } else {
                setSessionPassword(conn.id, password);
            }
        }
        await saveConnection(conn);
        toast("Connection imported", "success");
        setValue("");
        onImported();
    };

    return (
        <div className="mt-[var(--s7)] flex items-center gap-[var(--s4)]">
            <input
                type="text"
                className="mono w-96"
                placeholder="Paste a connection URL or SQLite path"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") importIt(); }}
            />
            <button className="btn" onClick={importIt}>
                <Icon name="link" />
                Import
            </button>
        </div>
    );
}
