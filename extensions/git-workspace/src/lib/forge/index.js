import * as gh from "@/lib/forge/gh";
import * as tea from "@/lib/forge/tea";
import * as glab from "@/lib/forge/glab";

let teaHostsPromise;
let glabHostsPromise;

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

async function glabHosts() {
    if (!glabHostsPromise) {
        glabHostsPromise = (async () => {
            const hosts = new Set(["gitlab.com"]);
            const res = await muxy.exec(["glab", "auth", "status"]).catch(() => null);
            if (!res)
                return hosts;
            const text = `${res.stdout}\n${res.stderr}`;
            for (const match of text.matchAll(/Logged in to ([^\s]+)\b/gi))
                hosts.add(match[1].toLowerCase());
            return hosts;
        })();
    }
    return glabHostsPromise;
}

async function originHost(cwd) {
    const res = await muxy.exec(["git", "remote", "get-url", "origin"], { cwd }).catch(() => null);
    if (!res || res.exitCode !== 0)
        return "";
    return parseHost(res.stdout);
}

async function backendFor(cwd) {
    const host = await originHost(cwd);
    if (!host)
        return gh;
    if ((await teaHosts()).has(host))
        return tea;
    if ((await glabHosts()).has(host))
        return glab;
    return gh;
}

export const prList = async (cwd, opts) => (await backendFor(cwd)).prList(cwd, opts);
export const prInfo = async (cwd) => (await backendFor(cwd)).prInfo(cwd);
export const statusPr = prInfo;
export const prCreate = async (cwd, opts) => (await backendFor(cwd)).prCreate(cwd, opts);
export const prMerge = async (cwd, opts) => (await backendFor(cwd)).prMerge(cwd, opts);
export const prClose = async (cwd, number) => (await backendFor(cwd)).prClose(cwd, number);
export const prReady = async (cwd, opts) => (await backendFor(cwd)).prReady(cwd, opts);
export const prCheckout = async (cwd, number) => (await backendFor(cwd)).prCheckout(cwd, number);
export const prepareWorktreeBranch = async (cwd, number) => (await backendFor(cwd)).prepareWorktreeBranch(cwd, number);
export const prDiff = async (cwd, number) => (await backendFor(cwd)).prDiff(cwd, number);
export const runList = async (cwd, opts) => (await backendFor(cwd)).runList(cwd, opts);
export const runRerun = async (cwd, id, opts) => (await backendFor(cwd)).runRerun(cwd, id, opts);
export const runCancel = async (cwd, id) => (await backendFor(cwd)).runCancel(cwd, id);
