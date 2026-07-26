const TAB_TYPE = "code-editor";

function tab_id_of(entry) {
  if (!entry || typeof entry !== "object") return null;
  const id = entry.tabID ?? entry.id ?? entry.tabInstanceID ?? entry.instanceID;
  return typeof id === "string" && id ? id : null;
}

function is_editor_entry(entry) {
  if (!entry || typeof entry !== "object") return false;
  const extId = entry.extensionID ?? entry.extension?.id;
  const type = entry.tabTypeID ?? entry.tabType ?? entry.extension?.tabType;
  return extId === muxy.extensionID && type === TAB_TYPE;
}

function file_path_of(entry) {
  let data = entry?.data ?? entry?.extension?.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  const filePath = data && typeof data === "object" ? data.filePath : null;
  return typeof filePath === "string" && filePath ? filePath : null;
}

function is_active_entry(entry) {
  if (!entry || typeof entry !== "object") return false;
  return entry.active === true || entry.focused === true || entry.isActive === true || entry.selected === true;
}

export class OpenTabsStore {
  constructor() {
    this.byPath = new Map();
    this.byTab = new Map();
    this.disposers = [];
  }

  start() {
    this.disposers.push(
      muxy.events.subscribe("tab.created", (payload) => this.track(payload)),
      muxy.events.subscribe("tab.updated", (payload) => this.track(payload)),
      muxy.events.subscribe("tab.closed", (payload) => this.untrack(payload)),
    );
    void this.seed();
  }

  dispose() {
    for (const dispose of this.disposers) dispose?.();
    this.disposers = [];
    this.byPath.clear();
    this.byTab.clear();
  }

  async seed() {
    let tabs;
    try {
      tabs = await muxy.tabs.list();
    } catch {
      return;
    }
    if (!Array.isArray(tabs)) return;
    this.byPath.clear();
    this.byTab.clear();
    for (const entry of tabs) {
      if (!is_editor_entry(entry)) continue;
      this.set(file_path_of(entry), tab_id_of(entry));
    }
  }

  track(payload) {
    if (!is_editor_entry(payload)) return;
    this.set(file_path_of(payload), tab_id_of(payload));
  }

  untrack(payload) {
    const tabId = tab_id_of(payload);
    if (tabId) this.removeByTab(tabId);
  }

  set(filePath, tabId) {
    if (!filePath || !tabId) return;
    const prevPath = this.byTab.get(tabId);
    if (prevPath && prevPath !== filePath) this.byPath.delete(prevPath);
    const prevTab = this.byPath.get(filePath);
    if (prevTab && prevTab !== tabId) this.byTab.delete(prevTab);
    this.byPath.set(filePath, tabId);
    this.byTab.set(tabId, filePath);
  }

  removeByTab(tabId) {
    const filePath = this.byTab.get(tabId);
    this.byTab.delete(tabId);
    if (filePath && this.byPath.get(filePath) === tabId) this.byPath.delete(filePath);
  }

  tabIdFor(filePath) {
    return this.byPath.get(filePath) ?? null;
  }

  filePathFor(tabId) {
    return this.byTab.get(tabId) ?? null;
  }

  async resolveTabId(filePath) {
    await this.seed();
    return this.tabIdFor(filePath);
  }

  async resolveFilePath(tabId) {
    if (!tabId) return null;
    const known = this.filePathFor(tabId);
    if (known) return known;
    await this.seed();
    return this.filePathFor(tabId);
  }

  async activeFilePath() {
    let tabs;
    try {
      tabs = await muxy.tabs.list();
    } catch {
      return null;
    }
    if (!Array.isArray(tabs)) return null;
    for (const entry of tabs) {
      if (!is_editor_entry(entry) || !is_active_entry(entry)) continue;
      return file_path_of(entry);
    }
    return null;
  }
}
