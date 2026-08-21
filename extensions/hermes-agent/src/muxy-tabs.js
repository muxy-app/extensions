const PROJECT_BOARD_TAB_TYPE = "hermes-project-board";

export function projectBoardTabRequest(extensionID) {
  const id = String(extensionID ?? "").trim();
  if (!id) throw new Error("Muxy extension ID is unavailable.");
  return {
    kind: "extensionWebView",
    extension: {
      id,
      tabType: PROJECT_BOARD_TAB_TYPE,
      singleton: true,
    },
  };
}

export async function openProjectBoardTab(muxy) {
  if (!muxy?.tabs || typeof muxy.tabs.open !== "function") {
    throw new Error("Muxy tab bridge is unavailable.");
  }
  return muxy.tabs.open(projectBoardTabRequest(muxy.extensionID));
}
