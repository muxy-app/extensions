import { httpJSON, httpRequest, HttpError, muxyExec } from "./http.js";

const PRODUCT = "Muxy Plex Dashboard";
const VERSION = "0.1.0";
const PLATFORM = "macOS";
const DEVICE_NAME = "Muxy";

const PLEX_TV = "https://plex.tv";
const AUTH_URL_BASE = "https://app.plex.tv/auth";

function clientHeaders(clientId, token) {
  const h = {
    "X-Plex-Product": PRODUCT,
    "X-Plex-Version": VERSION,
    "X-Plex-Platform": PLATFORM,
    "X-Plex-Device-Name": DEVICE_NAME,
    "X-Plex-Client-Identifier": clientId,
  };
  if (token) h["X-Plex-Token"] = token;
  return h;
}

export async function createPin({ clientId }) {
  const data = await httpJSON({
    method: "POST",
    url: `${PLEX_TV}/api/v2/pins?strong=true`,
    headers: clientHeaders(clientId),
  });
  if (!data || typeof data.id === "undefined" || !data.code) {
    throw new Error("createPin: unexpected response from plex.tv");
  }
  return { id: data.id, code: data.code };
}

export async function pollPin({ id, code, clientId }) {
  const data = await httpJSON({
    method: "GET",
    url: `${PLEX_TV}/api/v2/pins/${encodeURIComponent(id)}?code=${encodeURIComponent(code)}`,
    headers: clientHeaders(clientId),
  });
  return data && data.authToken ? data.authToken : null;
}

export function buildAuthUrl({ clientId, code }) {
  const params = new URLSearchParams();
  params.set("clientID", clientId);
  params.set("code", code);
  params.set("context[device][product]", PRODUCT);
  params.set("context[device][version]", VERSION);
  params.set("context[device][platform]", PLATFORM);
  params.set("context[device][device]", DEVICE_NAME);
  return `${AUTH_URL_BASE}#?${params.toString()}`;
}

export async function openInBrowser(url) {
  const exec = muxyExec();
  await exec(["/usr/bin/open", url], {});
}

export async function listOwnedServers({ token, clientId }) {
  const data = await httpJSON({
    method: "GET",
    url: `${PLEX_TV}/api/v2/resources?includeHttps=1&includeRelay=1`,
    headers: clientHeaders(clientId, token),
  });
  if (!Array.isArray(data)) return [];
  return data
    .filter((r) => r && r.provides && r.provides.includes("server") && r.owned === true)
    .map((r) => ({
      name: r.name,
      clientIdentifier: r.clientIdentifier,
      productVersion: r.productVersion,
      platform: r.platform,
      connections: Array.isArray(r.connections) ? r.connections : [],
    }));
}

function rankConnection(c) {
  if (c.local && !c.relay) return 0;
  if (!c.relay) return 1;
  return 2;
}

export async function pickConnection({ server, token, clientId }) {
  const sorted = [...server.connections].sort((a, b) => rankConnection(a) - rankConnection(b));
  let lastErr = null;
  for (const c of sorted) {
    try {
      await httpJSON({
        method: "GET",
        url: `${c.uri.replace(/\/$/, "")}/identity`,
        headers: clientHeaders(clientId, token),
        timeoutSec: 3,
      });
      return c;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `No reachable connection for ${server.name}. Last error: ${lastErr ? lastErr.message : "n/a"}`,
  );
}

function pmsUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

export async function getServerRoot({ baseUrl, token, clientId }) {
  const data = await httpJSON({
    method: "GET",
    url: pmsUrl(baseUrl, "/"),
    headers: clientHeaders(clientId, token),
    timeoutSec: 5,
  });
  const mc = data && data.MediaContainer ? data.MediaContainer : {};
  return {
    name: mc.friendlyName || "Plex Media Server",
    version: mc.version || "",
    platform: mc.platform || "",
    machineIdentifier: mc.machineIdentifier || "",
  };
}

export async function getResources({ baseUrl, token, clientId }) {
  const data = await httpJSON({
    method: "GET",
    url: pmsUrl(baseUrl, "/statistics/resources?timespan=6"),
    headers: clientHeaders(clientId, token),
    timeoutSec: 5,
  });
  const arr =
    data && data.MediaContainer && Array.isArray(data.MediaContainer.StatisticsResources)
      ? data.MediaContainer.StatisticsResources
      : [];
  if (arr.length === 0) return null;
  const latest = arr[arr.length - 1];
  return {
    hostCpuPct: Number(latest.hostCpuUtilization) || 0,
    hostRamPct: Number(latest.hostMemoryUtilization) || 0,
    processCpuPct: Number(latest.processCpuUtilization) || 0,
    processRamPct: Number(latest.processMemoryUtilization) || 0,
  };
}

export async function getSessions({ baseUrl, token, clientId }) {
  const data = await httpJSON({
    method: "GET",
    url: pmsUrl(baseUrl, "/status/sessions"),
    headers: clientHeaders(clientId, token),
    timeoutSec: 8,
    retries: 1,
  });
  const items =
    data && data.MediaContainer && Array.isArray(data.MediaContainer.Metadata)
      ? data.MediaContainer.Metadata
      : [];
  return items.map(normalizeSession);
}

function normalizeSession(m) {
  const session = m.Session || {};
  const player = m.Player || {};
  const user = m.User || {};
  const transcode = m.TranscodeSession || null;
  const media = Array.isArray(m.Media) && m.Media.length ? m.Media[0] : {};
  const title =
    m.type === "episode" && m.grandparentTitle
      ? `${m.grandparentTitle} — ${m.title || ""}`.trim()
      : m.title || "Untitled";
  return {
    id: session.id || String(m.sessionKey || ""),
    sessionKey: m.sessionKey ? String(m.sessionKey) : "",
    title,
    type: m.type || "unknown",
    user: user.title || "Unknown user",
    device: player.title || player.product || "Unknown device",
    address: player.address || "",
    state: player.state || "",
    duration: Number(m.duration) || 0,
    viewOffset: Number(m.viewOffset) || 0,
    bandwidthKbps: Number(session.bandwidth) || 0,
    location: session.location || "",
    isTranscoding: !!transcode,
    transcodeVideoDecision: transcode ? transcode.videoDecision : null,
    transcodeAudioDecision: transcode ? transcode.audioDecision : null,
    bitrateKbps: Number(media.bitrate) || 0,
  };
}

export async function terminateSession({ baseUrl, token, clientId, sessionId, reason }) {
  const params = new URLSearchParams();
  params.set("sessionId", sessionId);
  if (reason && reason.trim()) params.set("reason", reason.trim());
  await httpRequest({
    method: "GET",
    url: pmsUrl(baseUrl, `/status/sessions/terminate?${params.toString()}`),
    headers: clientHeaders(clientId, token),
    timeoutSec: 8,
  });
}

export { HttpError };
