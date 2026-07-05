import { Icon } from "../ui/icon.jsx";
import { ENGINES } from "../lib/connections.js";
import { SSL_MODES } from "./form-logic.js";

export function Field({ label, value, type = "text", list, placeholder, autoFocus, onChange }) {
    return (
        <div className="field">
            <label>{label}</label>
            <input
                autoFocus={autoFocus}
                type={type}
                list={list}
                placeholder={placeholder}
                value={value ?? ""}
                onChange={(e) => onChange(e.target.value)}
            />
        </div>
    );
}

export function SqliteFields({ conn, patch }) {
    const pick = async () => {
        const folder = await muxy.dialog.pickFolder({ title: "Choose database folder" });
        if (folder) {
            const name = conn.sqlite.path.split("/").pop() || "database.sqlite";
            patch({ sqlite: { ...conn.sqlite, path: `${folder}/${name}` } });
        }
    };
    return (
        <div className="field">
            <label>Database file</label>
            <div className="flex items-center gap-[var(--s3)]">
                <input
                    type="text"
                    className="mono flex-1"
                    placeholder="/path/to/database.sqlite"
                    value={conn.sqlite.path}
                    onChange={(e) => patch({ sqlite: { ...conn.sqlite, path: e.target.value } })}
                />
                <button className="btn" onClick={pick}>
                    <Icon name="folder" />
                </button>
            </div>
        </div>
    );
}

export function NetFields({ conn, patch, password, setPassword }) {
    const net = conn.net;
    const patchNet = (p) => patch({ net: { ...net, ...p } });
    return (
        <>
            <div className="flex gap-[var(--s4)]">
                <div className="field flex-1">
                    <label>Host</label>
                    <input type="text" value={net.host} onChange={(e) => patchNet({ host: e.target.value })} />
                </div>
                <div className="field w-24">
                    <label>Port</label>
                    <input
                        type="number"
                        value={net.port ?? ""}
                        onChange={(e) => patchNet({ port: Number(e.target.value) || ENGINES[conn.engine].defaultPort })}
                    />
                </div>
            </div>
            <Field label="User" value={net.user} onChange={(v) => patchNet({ user: v })} />
            <div className="field">
                <label>Password</label>
                <input
                    type="password"
                    placeholder={conn.keychain ? "Saved in Keychain — leave empty to keep" : "Password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                />
            </div>
            <Field label="Database" value={net.database} onChange={(v) => patchNet({ database: v })} />
            <div className="field">
                <label>SSL mode</label>
                <select value={net.sslMode} onChange={(e) => patchNet({ sslMode: e.target.value })}>
                    {(SSL_MODES[conn.engine] || [""]).map((mode) => (
                        <option key={mode} value={mode}>
                            {mode || "default"}
                        </option>
                    ))}
                </select>
            </div>
        </>
    );
}

export function SshSection({ conn, patch }) {
    if (conn.engine === "sqlite")
        return null;
    const ssh = conn.ssh || { enabled: false, host: "", port: 22, user: "", keyPath: "" };
    const patchSsh = (p) => patch({ ssh: { ...ssh, ...p } });
    return (
        <div className="field">
            <label className="flex items-center gap-[var(--s3)]">
                <input type="checkbox" checked={ssh.enabled} onChange={(e) => patchSsh({ enabled: e.target.checked })} />
                Connect over SSH tunnel
            </label>
            {ssh.enabled ? (
                <div className="flex flex-col gap-[var(--s5)]">
                    <div className="flex gap-[var(--s4)]">
                        <div className="field flex-1">
                            <label>SSH host</label>
                            <input type="text" value={ssh.host} onChange={(e) => patchSsh({ host: e.target.value })} />
                        </div>
                        <div className="field w-24">
                            <label>SSH port</label>
                            <input type="number" value={ssh.port} onChange={(e) => patchSsh({ port: Number(e.target.value) || 22 })} />
                        </div>
                    </div>
                    <Field label="SSH user" value={ssh.user} onChange={(v) => patchSsh({ user: v })} />
                    <div className="field">
                        <label>Private key path (optional)</label>
                        <input
                            type="text"
                            className="mono"
                            placeholder="Leave empty to use ssh-agent"
                            value={ssh.keyPath}
                            onChange={(e) => patchSsh({ keyPath: e.target.value })}
                        />
                    </div>
                    <div className="text-[var(--font-footnote)] text-muted-foreground">
                        Authentication uses your ssh-agent or the key file. Password prompts are disabled.
                    </div>
                </div>
            ) : null}
        </div>
    );
}
