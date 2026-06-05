import { has_dirty_replaceable_editor_for_other_file } from "@/lib/editor-state";

export function strip_slash(path) {
  return path.replace(/\/+$/, "");
}

export function canonical_dir(rel) {
  const clean = strip_slash(rel);
  return clean ? `${clean}/` : clean;
}

export function parent_dir(rel) {
  const clean = strip_slash(rel);
  const idx = clean.lastIndexOf("/");
  return idx === -1 ? "" : `${clean.slice(0, idx)}/`;
}

export function basename(path) {
  const clean = strip_slash(path);
  const idx = clean.lastIndexOf("/");
  return idx === -1 ? clean : clean.slice(idx + 1);
}

export function entry_to_rel(entry) {
  const rel = strip_slash(entry.path);
  return entry.isDirectory ? canonical_dir(rel) : rel;
}

export function error_message(err) {
  if (err instanceof Error) return err.message;
  const text = String(err).trim();
  return text || "Unknown error";
}

export async function confirm_action(opts) {
  try {
    const choice = await muxy.dialog.confirm({
      title: opts.title,
      message: opts.message,
      buttons: [opts.confirmLabel, "Cancel"],
      default: "Cancel",
      cancel: "Cancel",
      style: opts.critical ? "critical" : "warning",
    });
    return choice === opts.confirmLabel;
  } catch {
    return false;
  }
}

export async function alert_error(title, err) {
  try {
    await muxy.dialog.alert({ title, message: error_message(err), style: "critical" });
  } catch {
    return;
  }
}

export async function try_action(action, error_title) {
  try {
    await action();
    return true;
  } catch (err) {
    await alert_error(error_title, err);
    return false;
  }
}

export async function open_in_editor(rel) {
  try {
    const singleton = !has_dirty_replaceable_editor_for_other_file(rel);
    await muxy.tabs.open({
      kind: "extensionWebView",
      extension: {
        id: muxy.extensionID,
        tabType: "editor",
        singleton,
        data: { filePath: rel, replaceable: singleton },
      },
    });
  } catch {
    return;
  }
}

export async function reveal_in_finder(rel) {
  await muxy.exec(["open", "-R", strip_slash(rel)]).catch(() => undefined);
}

export async function open_externally(rel) {
  await muxy.exec(["open", strip_slash(rel)]).catch(() => undefined);
}

export async function copy_path(rel) {
  const path = strip_slash(rel);
  try {
    await navigator.clipboard.writeText(path);
    await muxy.toast({ body: "Path copied", variant: "info" }).catch(() => undefined);
  } catch {
    await muxy.toast({ title: "Copy path", body: path, variant: "info" }).catch(() => undefined);
  }
}
