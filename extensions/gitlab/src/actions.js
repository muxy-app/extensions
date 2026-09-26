// The action toolbelt under an item's description, and the panels it opens.
// Every write goes out as a glab subcommand and then re-reads the item, so the
// view always shows what GitLab actually stored rather than an optimistic guess.

import { state, nav, isMR, noun, thing } from "./state.js";
import { escapeHtml, splitList, userName } from "./util.js";
import { write, GlabError } from "./glab.js";
import { flash, isOpen } from "./views.js";
import * as icons from "./icons.js";

let openPanelAct = null;
let currentApprovals = null;

const refreshBtn = document.querySelector("#refresh");

/** Runs a glab write against the current project, then reloads the detail view. */
async function runWrite(args, okMsg) {
  refreshBtn.classList.add("is-spinning");
  try {
    await write(args, { repo: state.project?.web_url, cwd: state.cwd });
    await nav.detail(state.item.iid);
    flash(okMsg, "ok");
    return true;
  } catch (e) {
    const msg = e instanceof GlabError ? e.message : (e.message || String(e));
    flash(msg.trim().slice(0, 240), "error");
    return false;
  } finally {
    refreshBtn.classList.remove("is-spinning");
  }
}

function closePanel() {
  const panel = document.querySelector("#action-panel");
  if (panel) panel.innerHTML = "";
  openPanelAct = null;
}

// ---------------------------------------------------------------- toolbelt

export function renderActions(item, approvals) {
  currentApprovals = approvals;
  openPanelAct = null;

  const bar = document.querySelector("#actions");
  if (!bar) return;
  const open = isOpen(item);
  const draft = Boolean(item.draft || item.work_in_progress);

  const secondary = [
    { act: "comment", label: "Comment", icon: icons.ICON_COMMENT },
    { act: "edit", label: "Edit", icon: icons.ICON_EDIT },
    { act: "labels", label: "Labels & assignees", icon: icons.ICON_TAG },
  ];
  if (isMR()) {
    const approved = Boolean(approvals?.user_has_approved);
    secondary.push({
      act: "approve",
      label: approved ? "Revoke approval" : "Approve",
      icon: icons.ICON_APPROVE,
    });
    secondary.push({
      act: "ready",
      label: draft ? "Mark ready" : "Convert to draft",
      icon: icons.ICON_EYE,
    });
    secondary.push({ act: "checkout", label: "Check out locally", icon: icons.ICON_DOWNLOAD });
  }

  const primary = [];
  if (isMR() && open) primary.push({ act: "merge", label: "Merge", cls: "btn--accent" });
  primary.push({
    act: "toggle-state",
    label: open ? "Close" : "Reopen",
    cls: open ? "btn--danger" : "",
  });

  bar.innerHTML = `
    <div class="toolbelt__icons">
      ${secondary.map((b) => `<button class="icon-btn" data-act="${b.act}" title="${escapeHtml(b.label)}" aria-label="${escapeHtml(b.label)}">${b.icon}</button>`).join("")}
    </div>
    <div class="toolbelt__primary">
      ${primary.map((b) => `<button class="btn ${b.cls || ""}" data-act="${b.act}">${escapeHtml(b.label)}</button>`).join("")}
    </div>`;

  bar.querySelectorAll("[data-act]").forEach((btn) =>
    btn.addEventListener("click", () => openAction(btn.getAttribute("data-act"))));
}

const PANELS = {
  comment: panelComment,
  edit: panelEdit,
  labels: panelLabels,
  merge: panelMerge,
  "toggle-state": panelToggleState,
};

const DIRECT = {
  approve: actApprove,
  ready: actReady,
  checkout: actCheckout,
};

function openAction(act) {
  if (DIRECT[act]) {
    closePanel();
    return DIRECT[act]();
  }
  if (openPanelAct === act) return closePanel();
  openPanelAct = act;
  PANELS[act]?.(document.querySelector("#action-panel"));
}

// ------------------------------------------------------------------ panels

function panelComment(panel) {
  panel.innerHTML = `
    <div class="form">
      <textarea class="ta" id="c-body" placeholder="Write a comment (Markdown supported)"></textarea>
      <div class="form__actions">
        <button class="btn btn--accent" id="c-submit">Post comment</button>
      </div>
    </div>`;
  panel.querySelector("#c-submit").addEventListener("click", () => {
    const body = panel.querySelector("#c-body").value.trim();
    if (!body) return flash("Comment is empty.", "error");
    runWrite([noun(), "note", String(state.item.iid), "-m", body], "Comment posted");
  });
}

function panelEdit(panel) {
  panel.innerHTML = `
    <div class="form">
      <input class="inp" id="e-title" placeholder="Title" />
      <textarea class="ta" id="e-body" placeholder="Description (Markdown supported)"></textarea>
      <div class="form__actions">
        <button class="btn btn--accent" id="e-submit">Save</button>
      </div>
    </div>`;
  panel.querySelector("#e-title").value = state.item.title || "";
  panel.querySelector("#e-body").value = state.item.description || "";
  panel.querySelector("#e-submit").addEventListener("click", () => {
    const title = panel.querySelector("#e-title").value.trim();
    const body = panel.querySelector("#e-body").value;
    if (!title) return flash("Title is empty.", "error");
    const args = [noun(), "update", String(state.item.iid), "-t", title, "-d", body];
    if (isMR()) args.push("-y");
    runWrite(args, "Saved");
  });
}

/** Clickable suggestions that fill an input, drawn from the project's own data. */
function suggestHtml(values, target) {
  if (!values.length) return "";
  return `<div class="suggest">${values.slice(0, 12).map((v) =>
    `<button type="button" class="suggest__btn" data-suggest="${escapeHtml(v)}" data-target="${target}">${escapeHtml(v)}</button>`).join("")}</div>`;
}

function wireSuggestions(panel) {
  panel.querySelectorAll("[data-suggest]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const input = panel.querySelector(`#${btn.getAttribute("data-target")}`);
      const existing = splitList(input.value);
      const value = btn.getAttribute("data-suggest");
      if (!existing.includes(value)) existing.push(value);
      input.value = existing.join(", ");
      input.focus();
    }));
}

function panelLabels(panel) {
  const item = state.item;
  const currentLabels = (item.labels || []).map((l) => (typeof l === "string" ? l : l.name));
  const currentAssignees = (item.assignees || []).map(userName).filter(Boolean);

  const chip = (value, attr) =>
    `<span class="chip">${escapeHtml(value)}<button class="chip__x" data-${attr}="${escapeHtml(value)}" title="Remove">×</button></span>`;

  const unusedLabels = state.labels.map((l) => l.name).filter((n) => !currentLabels.includes(n));
  const unusedMembers = state.members.map(userName).filter((n) => n && !currentAssignees.includes(n));

  panel.innerHTML = `
    <div class="form">
      <div class="form__group">
        <div class="form__label">Labels</div>
        <div class="chips">${currentLabels.map((l) => chip(l, "rm-label")).join("") || '<span class="detail__empty">None</span>'}</div>
        <div class="form__row">
          <input class="inp" id="l-add" placeholder="Add labels (comma-separated)" />
          <button class="btn" id="l-add-btn">Add</button>
        </div>
        ${suggestHtml(unusedLabels, "l-add")}
      </div>
      <div class="form__group">
        <div class="form__label">Assignees</div>
        <div class="chips">${currentAssignees.map((a) => chip(a, "rm-asg")).join("") || '<span class="detail__empty">None</span>'}</div>
        <div class="form__row">
          <input class="inp" id="a-add" placeholder="Add assignees (comma-separated usernames)" />
          <button class="btn" id="a-add-btn">Add</button>
        </div>
        ${suggestHtml(unusedMembers, "a-add")}
      </div>
    </div>`;

  const iid = String(item.iid);
  const update = (args, msg) => runWrite([noun(), "update", iid, ...args, ...(isMR() ? ["-y"] : [])], msg);

  panel.querySelectorAll("[data-rm-label]").forEach((b) =>
    b.addEventListener("click", () => update(["-u", b.getAttribute("data-rm-label")], "Label removed")));

  // `!name` removes an assignee. The documented `-name` form would be parsed as
  // a flag once it reaches glab, so `!` is the only safe prefix to pass in argv.
  panel.querySelectorAll("[data-rm-asg]").forEach((b) =>
    b.addEventListener("click", () => update(["-a", `!${b.getAttribute("data-rm-asg")}`], "Assignee removed")));

  panel.querySelector("#l-add-btn").addEventListener("click", () => {
    const values = splitList(panel.querySelector("#l-add").value);
    if (!values.length) return;
    update(["-l", values.join(",")], "Labels added");
  });

  panel.querySelector("#a-add-btn").addEventListener("click", () => {
    const values = splitList(panel.querySelector("#a-add").value);
    if (!values.length) return;
    update(["-a", values.map((v) => `+${v.replace(/^@/, "")}`).join(",")], "Assignees added");
  });

  wireSuggestions(panel);
}

function panelMerge(panel) {
  panel.innerHTML = `
    <div class="form">
      <div class="form__row form__row--wrap">
        <label class="radio"><input type="radio" name="mm" value="" checked> Merge commit</label>
        <label class="radio"><input type="radio" name="mm" value="-s"> Squash</label>
        <label class="radio"><input type="radio" name="mm" value="-r"> Rebase</label>
      </div>
      <label class="check"><input type="checkbox" id="m-del"> Delete source branch after merge</label>
      <label class="check"><input type="checkbox" id="m-auto"> Merge when the pipeline succeeds</label>
      <div class="form__actions">
        <button class="btn btn--accent" id="m-submit">Merge this merge request</button>
      </div>
    </div>`;
  panel.querySelector("#m-submit").addEventListener("click", () => {
    const method = panel.querySelector('input[name="mm"]:checked').value;
    const auto = panel.querySelector("#m-auto").checked;
    // glab defaults --auto-merge to true, so an immediate merge must say so.
    const args = ["mr", "merge", String(state.item.iid), "-y", `--auto-merge=${auto}`];
    if (method) args.push(method);
    if (panel.querySelector("#m-del").checked) args.push("-d");
    runWrite(args, auto ? "Set to merge when the pipeline succeeds" : "Merged");
  });
}

function panelToggleState(panel) {
  const open = isOpen(state.item);
  const what = thing(false);
  panel.innerHTML = `
    <div class="form">
      <div class="detail__row">Are you sure you want to ${open ? "close" : "reopen"} this ${escapeHtml(what)}?</div>
      <div class="form__actions">
        <button class="btn ${open ? "btn--danger" : "btn--accent"}" id="ts-confirm">${open ? "Close" : "Reopen"}</button>
      </div>
    </div>`;
  panel.querySelector("#ts-confirm").addEventListener("click", () =>
    runWrite([noun(), open ? "close" : "reopen", String(state.item.iid)],
      open ? "Closed" : "Reopened"));
}

// ---------------------------------------------------------- direct actions

function actApprove() {
  const approved = Boolean(currentApprovals?.user_has_approved);
  return runWrite(
    ["mr", approved ? "revoke" : "approve", String(state.item.iid)],
    approved ? "Approval revoked" : "Approved",
  );
}

function actReady() {
  const draft = Boolean(state.item.draft || state.item.work_in_progress);
  return runWrite(
    ["mr", "update", String(state.item.iid), draft ? "-r" : "--draft", "-y"],
    draft ? "Marked ready" : "Converted to draft",
  );
}

/** Checkout is local-only, so it reports inline instead of reloading the item. */
async function actCheckout() {
  refreshBtn.classList.add("is-spinning");
  try {
    await write(["mr", "checkout", String(state.item.iid)], {
      repo: state.project?.web_url,
      cwd: state.cwd,
    });
    flash("Checked out locally", "ok");
  } catch (e) {
    flash((e.message || String(e)).trim().slice(0, 240), "error");
  } finally {
    refreshBtn.classList.remove("is-spinning");
  }
}

// ------------------------------------------------------------------ create

/** Arguments for creating a new item from the "New …" form's values. */
export function createArgs({ title, body, target, push, draft, removeBranch }) {
  const args = [noun(), "create", "-t", title, "-d", body, "-y", "--no-editor"];
  if (!isMR()) return args;
  if (target) args.push("-b", target);
  if (push) args.push("--push");
  if (draft) args.push("--draft");
  if (removeBranch) args.push("--remove-source-branch");
  return args;
}
