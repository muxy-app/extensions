import { render } from "./views/dom.js";
import { signedOutView } from "./views/signed-out.js";
import { confirmSignOutView } from "./views/confirm-signout.js";
import { serverPickerView } from "./views/server-picker.js";
import { dashboardView } from "./views/dashboard.js";
import { loadPrefs, savePrefs, clearSelectedServer, setServerSort, getServerSort } from "./prefs.js";
import { DEFAULT_SORT } from "./sessions.js";
import { readToken, deleteToken } from "./auth.js";
import {
  listOwnedServers,
  pickConnection,
  getServerRoot,
  getResources,
  getSessions,
  terminateSession,
  HttpError,
} from "./plex.js";

const app = document.getElementById("app");

const state = {
  token: null,
  prefs: null,
  servers: [],
  selectedServer: null,
  serverRoot: null,
  resourcesCache: null,
  dashboard: null,
  pollTimer: null,
  polling: false,
  consecutiveFailures: 0,
};

bootstrap().catch((err) => {
  console.error("bootstrap failed", err);
  showFatal(err);
});

async function bootstrap() {
  state.prefs = await loadPrefs();
  state.token = await readToken();
  registerCommandHandlers();
  document.addEventListener("visibilitychange", onVisibilityChange);

  if (!state.token) {
    showSignedOut();
    return;
  }
  await afterSignedIn();
}

function showSignedOut() {
  stopPolling();
  state.dashboard = null;
  state.selectedServer = null;
  render(
    app,
    signedOutView({
      onSignedIn: async (token) => {
        state.token = token;
        await afterSignedIn();
      },
    }),
  );
}

async function afterSignedIn() {
  let owned;
  try {
    owned = await listOwnedServers({ token: state.token, clientId: state.prefs.clientId });
  } catch (err) {
    if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
      await signOut();
      return;
    }
    showFatal(err);
    return;
  }
  state.servers = owned;

  if (owned.length === 0) {
    render(app, noServersView());
    return;
  }

  const remembered =
    state.prefs.selectedServer &&
    owned.find((s) => s.clientIdentifier === state.prefs.selectedServer.clientIdentifier);

  if (remembered) {
    await selectServer(remembered);
    return;
  }

  if (owned.length === 1) {
    await selectServer(owned[0]);
    return;
  }

  render(
    app,
    serverPickerView({
      servers: owned,
      onPick: (s) => selectServer(s),
    }),
  );
}

async function selectServer(server) {
  let connection;
  try {
    connection = await pickConnection({
      server,
      token: state.token,
      clientId: state.prefs.clientId,
    });
  } catch (err) {
    showFatal(err);
    return;
  }

  state.selectedServer = {
    clientIdentifier: server.clientIdentifier,
    name: server.name,
    productVersion: server.productVersion,
    platform: server.platform,
    uri: connection.uri,
  };
  await savePrefs({ selectedServer: state.selectedServer });

  try {
    state.serverRoot = await getServerRoot({
      baseUrl: state.selectedServer.uri,
      token: state.token,
      clientId: state.prefs.clientId,
    });
  } catch {
    state.serverRoot = { name: server.name, version: server.productVersion || "", platform: server.platform || "" };
  }

  startDashboard();
}

function startDashboard() {
  const serverId = state.selectedServer.clientIdentifier;
  const initialSort = getServerSort(state.prefs, serverId, DEFAULT_SORT);
  const view = dashboardView({
    server: {
      name: state.serverRoot.name || state.selectedServer.name,
      version: state.serverRoot.version,
      platform: state.serverRoot.platform,
    },
    initialSort,
    initialRefreshSec: state.prefs.refreshIntervalSec || 10,
    onStopRequested: async (session, message) => {
      await terminateSession({
        baseUrl: state.selectedServer.uri,
        token: state.token,
        clientId: state.prefs.clientId,
        sessionId: session.id,
        reason: message,
      });
      await pollOnce();
    },
    onSortChange: (sortKey) => {
      setServerSort(serverId, sortKey).then((next) => {
        state.prefs = next;
      });
    },
    onRefreshIntervalChange: (sec) => {
      savePrefs({ refreshIntervalSec: sec }).then((next) => {
        state.prefs = next;
        startPolling();
      });
    },
  });
  state.dashboard = view;
  render(app, view.node);
  pollOnce();
  startPolling();
}

function startPolling() {
  stopPolling();
  const ms = (state.prefs.refreshIntervalSec || 10) * 1000;
  state.pollTimer = setInterval(() => {
    if (document.visibilityState === "visible") pollOnce();
  }, ms);
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function onVisibilityChange() {
  if (document.visibilityState === "visible" && state.dashboard) {
    pollOnce();
  }
}

async function pollOnce() {
  if (!state.dashboard || !state.selectedServer || !state.token) return;
  if (state.polling) return; // avoid overlapping polls when a request runs long
  state.polling = true;
  try {
    const [sessions, resources] = await Promise.all([
      getSessions({
        baseUrl: state.selectedServer.uri,
        token: state.token,
        clientId: state.prefs.clientId,
      }),
      maybeFetchResources(),
    ]);
    const stats = computeStats(sessions, resources);
    state.consecutiveFailures = 0;
    state.dashboard.update({ stats, sessions, error: null });
  } catch (err) {
    if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
      await signOut();
      return;
    }
    // Transient poll failure (network blip, relay hiccup, server momentarily
    // unreachable). Stay silent: leave the last-good view on screen, retry in the
    // background on the next cycle, and only log for debugging. The user never sees
    // a network/reconnecting message — it just keeps working when the link returns.
    state.consecutiveFailures += 1;
    console.warn(`Plex poll failed (${state.consecutiveFailures}x) — keeping last view, retrying`, err);
  } finally {
    state.polling = false;
  }
}

async function maybeFetchResources() {
  try {
    const value = await getResources({
      baseUrl: state.selectedServer.uri,
      token: state.token,
      clientId: state.prefs.clientId,
    });
    if (value) state.resourcesCache = value;
    return state.resourcesCache;
  } catch {
    return state.resourcesCache;
  }
}

function computeStats(sessions, resources) {
  const transcoding = sessions.filter((s) => s.isTranscoding).length;
  const direct = sessions.length - transcoding;
  const bandwidth = sessions.reduce((acc, s) => acc + (s.bandwidthKbps || s.bitrateKbps || 0), 0);
  return {
    sessionsCount: sessions.length,
    directCount: direct,
    transcodingCount: transcoding,
    totalBandwidthKbps: bandwidth,
    cpuPct: resources ? resources.hostCpuPct : null,
    ramPct: resources ? resources.hostRamPct : null,
  };
}

function confirmSignOut() {
  if (document.getElementById("signout-confirm-host")) return;
  const host = document.createElement("div");
  host.id = "signout-confirm-host";
  const close = () => host.remove();
  host.append(
    confirmSignOutView({
      onCancel: close,
      onConfirm: () => {
        close();
        signOut();
      },
    }),
  );
  document.body.append(host);
}

async function signOut() {
  stopPolling();
  await deleteToken();
  await clearSelectedServer();
  state.token = null;
  state.dashboard = null;
  state.selectedServer = null;
  state.resourcesCache = null;
  showSignedOut();
}

function noServersView() {
  const node = document.createElement("section");
  node.className = "view";
  node.innerHTML = `
    <header><h1>No owned servers</h1></header>
    <div class="card">
      <p>This Plex account doesn't own any Plex Media Servers. Sign out and sign in with an admin account.</p>
      <button class="primary" id="so">Sign out</button>
    </div>
  `;
  node.querySelector("#so").addEventListener("click", () => confirmSignOut());
  return node;
}

function showFatal(err) {
  const node = document.createElement("section");
  node.className = "view";
  node.innerHTML = `
    <header><h1>Something went wrong</h1></header>
    <div class="card">
      <p class="error"></p>
      <button class="primary" id="retry">Retry</button>
      <button id="signout">Sign out</button>
    </div>
  `;
  node.querySelector(".error").textContent = err?.message || String(err);
  node.querySelector("#retry").addEventListener("click", () => bootstrap());
  node.querySelector("#signout").addEventListener("click", () => confirmSignOut());
  render(app, node);
}

function registerCommandHandlers() {
  const handle = (id) => {
    if (id === "refresh") pollOnce();
    else if (id === "signout") confirmSignOut();
  };

  const m = window.muxy;
  if (m && m.events && typeof m.events.subscribe === "function") {
    try {
      m.events.subscribe("command.refresh", () => handle("refresh"));
      m.events.subscribe("command.signout", () => handle("signout"));
    } catch (err) {
      console.warn("Failed to subscribe to header button commands", err);
    }
  }
}
