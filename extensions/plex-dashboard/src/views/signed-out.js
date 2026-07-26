import { el } from "./dom.js";
import { loadPrefs } from "../prefs.js";
import { writeToken } from "../auth.js";
import { createPin, pollPin, buildAuthUrl, openInBrowser } from "../plex.js";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

export function signedOutView({ onSignedIn }) {
  const status = el("p", { class: "status muted" }, "Sign in with your Plex account to begin.");
  const errorEl = el("p", { class: "error", style: { display: "none" } });
  const codeEl = el("code", { class: "pin", style: { display: "none" } });

  const button = el(
    "button",
    {
      class: "primary",
      onClick: async () => {
        await beginSignIn({ button, status, errorEl, codeEl, onSignedIn });
      },
    },
    "Sign in with Plex",
  );

  return el(
    "section",
    { class: "view view-signed-out" },
    el("header", null, el("h1", null, "Plex Dashboard")),
    el(
      "div",
      { class: "card" },
      el("p", null, "Monitor playback and stop streams on Plex Media Servers you own."),
      button,
      status,
      codeEl,
      errorEl,
    ),
  );
}

async function beginSignIn({ button, status, errorEl, codeEl, onSignedIn }) {
  button.disabled = true;
  errorEl.style.display = "none";
  errorEl.textContent = "";
  status.textContent = "Requesting a sign-in code from plex.tv…";

  let pin;
  try {
    const prefs = await loadPrefs();
    pin = await createPin({ clientId: prefs.clientId });
  } catch (err) {
    showError(errorEl, err);
    button.disabled = false;
    return;
  }

  codeEl.textContent = pin.code;
  codeEl.style.display = "block";
  status.textContent = "Opening your browser to complete sign-in. Waiting for approval…";

  try {
    const prefs = await loadPrefs();
    await openInBrowser(buildAuthUrl({ clientId: prefs.clientId, code: pin.code }));
  } catch (err) {
    showError(errorEl, err);
    button.disabled = false;
    return;
  }

  const token = await pollForToken(pin);
  if (!token) {
    showError(errorEl, new Error("Sign-in timed out. Try again."));
    button.disabled = false;
    return;
  }

  try {
    await writeToken(token);
  } catch (err) {
    showError(errorEl, err);
    button.disabled = false;
    return;
  }

  status.textContent = "Signed in. Loading your servers…";
  onSignedIn(token);
}

async function pollForToken({ id, code }) {
  const prefs = await loadPrefs();
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const token = await pollPin({ id, code, clientId: prefs.clientId });
      if (token) return token;
    } catch (err) {
      console.warn("pin poll error", err);
    }
  }
  return null;
}

function showError(node, err) {
  node.style.display = "block";
  node.textContent = err?.message || String(err);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
