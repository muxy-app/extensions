const KEY = "plex-dashboard:token";

export async function readToken() {
  try {
    return window.localStorage.getItem(KEY) || null;
  } catch {
    return null;
  }
}

export async function writeToken(token) {
  if (!token || typeof token !== "string") {
    throw new Error("writeToken: a non-empty string is required");
  }
  try {
    window.localStorage.setItem(KEY, token);
  } catch (err) {
    throw new Error(`writeToken: localStorage unavailable: ${err.message}`);
  }
}

export async function deleteToken() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
