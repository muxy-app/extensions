import * as gh from "@/lib/forge/gh";
import * as tea from "@/lib/forge/tea";

let teaHostsPromise;

function parseHost(url) {
    const s = (url || "").trim();
    const scheme = s.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/(?:[^@/]+@)?([^:/]+)/);
    if (scheme)
        return scheme[1].toLowerCase();
    const scp = s.match(/^(?:[^@]+@)?([^:/]+):/);
    if (scp)
        return scp[1].toLowerCase();
    return "";
}

async function teaHosts() {
    if (!teaHostsPromise) {
        teaHostsPromise = (async () => {
            const res = await muxy.exec(["tea", "login", "list", "--output", "json"]).catch(() => null);
            if (!res || res.exitCode !== 0 || !res.stdout.trim())
                return new Set();
            try {
                const logins = JSON.parse(res.stdout);
                const hosts = new Set();
                for (const login of Array.isArray(logins) ? logins : []) {
                    const fromUrl = parseHost(login.url);
                    if (fromUrl)
                        hosts.add(fromUrl);
                    if (login.ssh_host)
                        hosts.add(String(login.ssh_host).toLowerCase());
                }
                return hosts;
            }
            catch {
                return new Set();
            }
        })();
    }
    return teaHostsPromise;
}

async function originHost() {
    const res = await muxy.exec(["git", "remote", "get-url", "origin"]).catch(() => null);
    if (!res || res.exitCode !== 0)
        return "";
    return parseHost(res.stdout);
}

async function backend() {
    const host = await originHost();
    const hosts = await teaHosts();
    return host && hosts.has(host) ? tea : gh;
}

export const prList = async (opts) => (await backend()).prList(opts);
export const prInfo = async () => (await backend()).prInfo();
export const prCreate = async (opts) => (await backend()).prCreate(opts);
export const prMerge = async (opts) => (await backend()).prMerge(opts);
export const prClose = async (number) => (await backend()).prClose(number);
export const prReady = async (opts) => (await backend()).prReady(opts);
export const prCheckout = async (number) => (await backend()).prCheckout(number);
export const prCheckoutWorktree = async (number, path) => (await backend()).prCheckoutWorktree(number, path);
export const prDiff = async (number) => (await backend()).prDiff(number);
export const runList = async (opts) => (await backend()).runList(opts);
export const runRerun = async (id, opts) => (await backend()).runRerun(id, opts);
export const runCancel = async (id) => (await backend()).runCancel(id);
