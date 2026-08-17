const PREFERRED_CLI = "preferredCli";
const LIST_FILTER = "listFilter";

async function read(key, fallback) {
  try {
    const value = await muxy.storage.get(key);
    return typeof value === "string" && value ? value : fallback;
  } catch {
    // Preferences must never prevent the panel from rendering. This also
    // keeps older installs usable until the newly declared permissions are
    // granted after an extension update.
    return fallback;
  }
}

async function write(key, value) {
  try {
    await muxy.storage.set(key, value);
    return true;
  } catch {
    // A denied preference write should affect persistence, not the panel UI.
    return false;
  }
}

export async function getPreferredCli() {
  return read(PREFERRED_CLI, "grok");
}

export async function setPreferredCli(cli) {
  return write(PREFERRED_CLI, cli);
}

export async function getListFilter() {
  return read(LIST_FILTER, "all");
}

export async function setListFilter(filter) {
  return write(LIST_FILTER, filter);
}
