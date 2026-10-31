import { strip_slash } from "@/shared/paths";

export function error_message(err) {
  if (err instanceof Error) return err.message;
  const text = String(err ?? "").trim();
  return text || "Unknown error";
}

export function toast(body, variant = "info", title = undefined) {
  void muxy.toast?.({ title, body, variant })?.catch?.(() => undefined);
}

export async function alert_error(title, err) {
  try {
    await muxy.dialog.alert({ title, message: error_message(err), style: "critical" });
  } catch {}
}

export async function confirm_action({ title, message, confirmLabel, critical = false }) {
  try {
    const choice = await muxy.dialog.confirm({
      title,
      message,
      buttons: [confirmLabel, "Cancel"],
      default: critical ? "Cancel" : confirmLabel,
      cancel: "Cancel",
      style: critical ? "critical" : "warning",
    });
    return choice === confirmLabel;
  } catch {
    return false;
  }
}

// `exec` runs in the project folder, so project-relative paths work as-is.
export function reveal_in_finder(paths) {
  const list = (Array.isArray(paths) ? paths : [paths]).map((path) => strip_slash(path) || ".");
  if (list.length > 0) void muxy.exec(["open", "-R", ...list]).catch(() => undefined);
}

export function open_externally(path) {
  void muxy.exec(["open", strip_slash(path) || "."]).catch(() => undefined);
}

export function open_url(url) {
  void muxy.exec(["open", url]).catch(() => undefined);
}

export async function copy_text(text, label = "Copied") {
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    try {
      const res = await muxy.exec(["pbcopy"], { stdin: text });
      copied = res?.exitCode === 0;
    } catch {}
  }
  toast(copied ? label : text, "info", copied ? undefined : "Copy");
}
