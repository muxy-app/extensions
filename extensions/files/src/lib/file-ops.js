import { alert_error, basename, canonical_dir, confirm_action, parent_dir, try_action } from "@/lib/files";

const NEW_FILE_NAME = "untitled";
const NEW_FOLDER_NAME = "untitled-folder";

function split_ext(name, isFolder) {
  if (isFolder) return { stem: name, ext: "" };
  const idx = name.lastIndexOf(".");
  if (idx <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, idx), ext: name.slice(idx) };
}

export async function create_file(parentRel) {
  const parent = canonical_dir(parentRel);
  const rel = `${parent}${NEW_FILE_NAME}`;
  const ok = await try_action(async () => {
    await muxy.files.write(rel, "");
  }, "Create File");
  return ok ? rel : null;
}

export async function create_folder(parentRel) {
  const parent = canonical_dir(parentRel);
  const rel = canonical_dir(`${parent}${NEW_FOLDER_NAME}`);
  const ok = await try_action(async () => {
    await muxy.files.mkdir(rel);
  }, "Create Folder");
  return ok ? rel : null;
}

export async function delete_paths(rels) {
  if (rels.length === 0) return false;
  const count = rels.length;
  const label = count === 1 ? basename(rels[0]) : `${count} items`;
  const confirmed = await confirm_action({
    critical: true,
    title: "Delete",
    message: `Move ${label} to Trash?`,
    confirmLabel: "Delete",
  });
  if (!confirmed) return false;
  return try_action(async () => {
    await muxy.files.delete(rels.map((rel) => rel));
  }, "Delete");
}

export async function duplicate(rel) {
  const isFolder = rel.endsWith("/");
  const parent = parent_dir(rel);
  const name = basename(rel);
  const { stem, ext } = split_ext(name, isFolder);

  let destName = `${stem} copy${ext}`;
  for (let n = 2; ; n++) {
    const candidate = `${parent}${destName}`;
    let exists = true;
    try {
      await muxy.files.stat(candidate);
    } catch {
      exists = false;
    }
    if (!exists) break;
    destName = `${stem} copy ${n}${ext}`;
  }

  const destRelRaw = `${parent}${destName}`;
  const ok = await try_action(async () => {
    const result = await muxy.exec(["cp", "-R", strip_slash_local(rel), strip_slash_local(destRelRaw)]);
    if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `cp exited ${result.exitCode}`);
  }, "Duplicate");
  if (!ok) return null;
  return isFolder ? canonical_dir(destRelRaw) : destRelRaw;
}

function strip_slash_local(path) {
  return path.replace(/\/+$/, "");
}

export async function rename_fs(sourceRel, destRel, isFolder) {
  const sourcePath = isFolder ? canonical_dir(sourceRel) : sourceRel;
  const newName = basename(destRel);
  try {
    await muxy.files.rename(sourcePath, newName);
    return true;
  } catch (err) {
    await alert_error("Rename", err);
    return false;
  }
}

export async function move_fs(draggedRels, targetDirRel) {
  if (draggedRels.length === 0) return true;
  const into = strip_slash_local(targetDirRel);
  try {
    await muxy.files.move(draggedRels.map((rel) => strip_slash_local(rel)), into);
    return true;
  } catch (err) {
    await alert_error("Move", err);
    return false;
  }
}
