// Unsaved edits kept across a crash or reload while auto save is off. One key
// per file, scoped to the project root, so a draft can never land in another
// project's file of the same name. A draft is only offered back when the file
// on disk still matches what the draft was based on.

import { keys_with_prefix, read_json, remove_key, write_json } from "@/shared/prefs";

const PREFIX = "muxy.files.draft:";
const MAX_DRAFT_CHARS = 2_000_000;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const key_for = (root, path) => `${PREFIX}${root}|${path}`;

export function read_draft(root, path) {
  if (!root || !path) return null;
  const draft = read_json(key_for(root, path));
  if (!draft || typeof draft.content !== "string" || typeof draft.baseline !== "string") return null;
  return draft;
}

export function write_draft(root, path, content, baseline) {
  if (!root || !path || typeof content !== "string" || typeof baseline !== "string") return;
  if (content.length > MAX_DRAFT_CHARS) return;
  write_json(key_for(root, path), { content, baseline, at: Date.now() });
}

export function clear_draft(root, path) {
  if (root && path) remove_key(key_for(root, path));
}

export function prune_drafts() {
  const now = Date.now();
  for (const key of keys_with_prefix(PREFIX)) {
    const draft = read_json(key);
    if (!draft || now - (draft.at ?? 0) > MAX_AGE_MS) remove_key(key);
  }
}
