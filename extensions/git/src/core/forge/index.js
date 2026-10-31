import * as gh from "@/core/forge/gh";
import * as tea from "@/core/forge/tea";
import { remoteUrl, tryRun } from "@/core/git";
import { remoteHost } from "@/core/remote";

let teaHosts = null;
const backends = new Map();

function loadTeaHosts() {
  teaHosts ??= tryRun(["tea", "login", "list", "--output", "json"]).then((out) => {
    const hosts = new Set();
    try {
      for (const login of JSON.parse(out || "[]")) {
        const host = remoteHost(login.url);
        if (host) hosts.add(host);
        if (login.ssh_host) hosts.add(String(login.ssh_host).toLowerCase());
      }
    } catch {}
    return hosts;
  });
  return teaHosts;
}

async function detect() {
  const url = await remoteUrl();
  if (!url) return { kind: "none", api: gh, url: "" };
  const host = remoteHost(url);
  if (host !== "github.com" && (await loadTeaHosts()).has(host)) return { kind: tea.kind, api: tea, url };
  return { kind: gh.kind, api: gh, url };
}

export function forgeFor(root) {
  const key = root ?? "";
  if (!backends.has(key)) {
    const promise = detect().catch(() => ({ kind: "none", api: gh, url: "" }));
    backends.set(key, promise);
  }
  return backends.get(key);
}

export function forgetForge(root) {
  backends.delete(root ?? "");
}
