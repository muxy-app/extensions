const PREFERRED_CLI = "preferredCli";
const LIST_FILTER = "listFilter";

export async function getPreferredCli() {
  const value = await muxy.storage.get(PREFERRED_CLI);
  return typeof value === "string" && value ? value : "grok";
}

export async function setPreferredCli(cli) {
  await muxy.storage.set(PREFERRED_CLI, cli);
}

export async function getListFilter() {
  const value = await muxy.storage.get(LIST_FILTER);
  return typeof value === "string" && value ? value : "all";
}

export async function setListFilter(filter) {
  await muxy.storage.set(LIST_FILTER, filter);
}
