import { openConfirm } from "@/shared/popover";

let dialogAnchor = null;

export function setDialogAnchor(element) {
  dialogAnchor = element;
}

function anchor() {
  return dialogAnchor && document.body.contains(dialogAnchor) ? dialogAnchor : null;
}

export function errorMessage(err) {
  if (err instanceof Error) return err.message.trim() || "Unknown error";
  const text = String(err ?? "").trim();
  return text || "Unknown error";
}

export function toast(body, title = undefined) {
  void muxy.toast?.({ title, body })?.catch?.(() => undefined);
}

export async function alertError(title, err) {
  const message = errorMessage(err).slice(0, 1900);
  if (anchor()) return void (await openConfirm({ anchor: anchor(), title, message, buttons: [] }));
  try {
    await muxy.dialog.alert({ title, message, style: "critical" });
  } catch {}
}

export async function ask({ title, message, buttons, critical = false }) {
  if (anchor()) return openConfirm({ anchor: anchor(), title, message, buttons, critical });
  try {
    const choice = await muxy.dialog.confirm({
      title,
      message,
      buttons: [...buttons, "Cancel"].slice(0, 3),
      default: critical ? "Cancel" : buttons[0],
      cancel: "Cancel",
      style: critical ? "critical" : "warning",
    });
    return choice && choice !== "Cancel" ? choice : null;
  } catch {
    return null;
  }
}

export async function confirmAction({ title, message, confirmLabel, critical = false }) {
  return (await ask({ title, message, buttons: [confirmLabel], critical })) === confirmLabel;
}

export function openUrl(url) {
  if (url) void muxy.exec(["open", url]).catch(() => undefined);
}

export function revealInFinder(path) {
  void muxy.exec(["open", "-R", path || "."]).catch(() => undefined);
}

export async function copyText(text, label = "Copied") {
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    try {
      copied = (await muxy.exec(["pbcopy"], { stdin: text }))?.exitCode === 0;
    } catch {}
  }
  toast(copied ? label : text, copied ? undefined : "Copy");
}

export async function openInEditor(path) {
  try {
    await muxy.tabs.open({
      kind: "extensionWebView",
      extension: { id: "files", tabType: "code-editor", data: { filePath: path, source: "terminal" } },
    });
  } catch {
    toast("Install the Files extension to open files.", "Could not open the file");
  }
}
