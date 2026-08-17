import { changedFileCount, errorMessage } from "@/commit/model";
import { hasPendingChanges, openUrl } from "@/lib/git";
import { branchNameFromTitle, createPr, existingPrUrl } from "@/lib/pr";
import * as repo from "@/lib/repo";
import {
    branchOptions,
    canSubmitCreatePr,
    createPrFieldLocks,
    createPrShortcut,
    isDefaultBranch,
    repositoryHint,
} from "./model";
import "@/commit/commit.css";
import "./create-pr.css";

const titleInput = document.querySelector("#pr-title");
const bodyInput = document.querySelector("#pr-body");
const branchContext = document.querySelector("#branch-context");
const changes = document.querySelector("#changes");
const advancedToggle = document.querySelector("#advanced-toggle");
const advancedOptions = document.querySelector("#advanced-options");
const newBranchField = document.querySelector("#new-branch-field");
const newBranchInput = document.querySelector("#new-branch");
const baseBranchSelect = document.querySelector("#base-branch");
const draftInput = document.querySelector("#draft");
const status = document.querySelector("#status");
const createButton = document.querySelector("#create-pr");
const createButtonLabel = createButton?.querySelector(".button-label");

let ready = false;
let busy = false;
let advanced = false;
let branchEdited = false;
let currentBranch = "";
let defaultBranch = "";
let changeCount = 0;
let branchPrepared = false;
let changesPrepared = false;
let pushed = false;

function setStatus(text, tone = "") {
    status.textContent = text;
    status.title = text;
    status.className = `commit-status${tone ? ` commit-status-${tone}` : ""}`;
}

function selectedBaseBranch() {
    return baseBranchSelect.value || defaultBranch || undefined;
}

function pendingNewBranch() {
    if (!isDefaultBranch(currentBranch, defaultBranch) || branchPrepared)
        return undefined;
    return newBranchInput.value.trim() || undefined;
}

function effectiveSourceBranch() {
    return pendingNewBranch() || currentBranch || "No branch";
}

function updateBranchContext() {
    branchContext.textContent = `${effectiveSourceBranch()} → ${selectedBaseBranch() || "default"}`;
    branchContext.title = branchContext.textContent;
}

function isPartiallyComplete() {
    return branchPrepared || changesPrepared || pushed;
}

function syncControls() {
    const canCreate = canSubmitCreatePr({
        ready,
        busy,
        currentBranch,
        defaultBranch,
        newBranch: newBranchInput.value,
        title: titleInput.value,
    });
    const locks = createPrFieldLocks(busy, branchPrepared);
    for (const field of [titleInput, bodyInput, baseBranchSelect, draftInput])
        field.disabled = locks.metadata;
    newBranchInput.disabled = locks.sourceBranch;
    advancedToggle.disabled = busy;
    createButton.disabled = !canCreate;
    createButtonLabel.textContent = isPartiallyComplete() ? "Retry Create PR" : "Create PR";
    document.body.classList.toggle("commit-is-busy", busy);
}

function populateBranches(branches) {
    const selected = defaultBranch || "";
    const options = branchOptions(branches, currentBranch, selected);
    baseBranchSelect.replaceChildren();
    if (options.length === 0) {
        const option = document.createElement("option");
        option.value = selected;
        option.textContent = selected || "Repository default";
        baseBranchSelect.appendChild(option);
        return;
    }
    for (const name of options) {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        option.selected = name === selected;
        baseBranchSelect.appendChild(option);
    }
}

function updateRepositoryHint() {
    changes.lastElementChild.textContent = repositoryHint(changeCount);
    changes.classList.toggle("commit-changes-empty", changeCount === 0);
}

function updateGeneratedBranch() {
    if (!branchEdited && isDefaultBranch(currentBranch, defaultBranch))
        newBranchInput.value = titleInput.value.trim() ? branchNameFromTitle(titleInput.value) : "";
    updateBranchContext();
}

async function initialize() {
    try {
        const [snapshot, branches] = await Promise.all([
            muxy.git.status({ local: true, fresh: true }),
            muxy.git.branches({ fresh: true }),
        ]);
        currentBranch = snapshot.branch || "";
        defaultBranch = snapshot.defaultBranch || "";
        changeCount = changedFileCount(snapshot);
        populateBranches(branches);
        newBranchField.hidden = !isDefaultBranch(currentBranch, defaultBranch);
        updateRepositoryHint();
        updateGeneratedBranch();
        if (!currentBranch)
            setStatus("Create or switch to a branch before opening a pull request", "error");
        ready = true;
    }
    catch (error) {
        changes.lastElementChild.textContent = "Repository unavailable";
        changes.classList.add("commit-changes-empty");
        setStatus(`Could not load repository: ${errorMessage(error)}`, "error");
    }
    finally {
        syncControls();
        titleInput.focus();
    }
}

async function notifySuccess() {
    await muxy.notifications.notify({
        title: draftInput.checked ? "Draft pull request created" : "Pull request created",
        body: titleInput.value.trim(),
    }).catch(() => undefined);
}

async function handleExistingPullRequest(error) {
    const url = existingPrUrl(error);
    if (!url)
        return false;
    const choice = await muxy.dialog.confirm({
        title: "Pull request already exists",
        message: "A pull request for this branch already exists. Open it?",
        buttons: ["Open PR", "Close"],
        default: "Open PR",
        cancel: "Close",
    }).catch(() => "Close");
    if (choice === "Open PR")
        openUrl(url);
    muxy.lifecycle.close();
    return true;
}

async function submit() {
    const title = titleInput.value.trim();
    if (!canSubmitCreatePr({
        ready,
        busy,
        currentBranch,
        defaultBranch,
        newBranch: newBranchInput.value,
        title,
    }))
        return;

    busy = true;
    setStatus("Preparing pull request…");
    syncControls();

    try {
        const newBranch = pendingNewBranch();
        if (!branchPrepared && newBranch) {
            setStatus(`Creating branch ${newBranch}…`);
            await repo.branchCreate(newBranch);
            currentBranch = newBranch;
            branchPrepared = true;
            updateBranchContext();
        }

        if (!changesPrepared) {
            if (await hasPendingChanges()) {
                setStatus("Staging and committing changes…");
                await repo.commit({ message: title, stageAll: true });
            }
            changesPrepared = true;
        }

        if (!pushed) {
            setStatus("Pushing branch…");
            await repo.push({ setUpstream: true });
            pushed = true;
        }

        setStatus(draftInput.checked ? "Creating draft pull request…" : "Creating pull request…");
        await createPr(title, bodyInput.value.trim(), selectedBaseBranch(), draftInput.checked);
        setStatus(draftInput.checked ? "Draft pull request created" : "Pull request created", "success");
        await notifySuccess();
        muxy.lifecycle.close();
    }
    catch (error) {
        if (await handleExistingPullRequest(error))
            return;
        setStatus(`Could not create pull request: ${errorMessage(error)}`, "error");
    }
    finally {
        busy = false;
        syncControls();
    }
}

titleInput?.addEventListener("input", () => {
    if (!busy)
        setStatus("");
    updateGeneratedBranch();
    syncControls();
});
newBranchInput?.addEventListener("input", () => {
    branchEdited = true;
    updateBranchContext();
    syncControls();
});
baseBranchSelect?.addEventListener("change", updateBranchContext);
advancedToggle?.addEventListener("click", () => {
    advanced = !advanced;
    advancedOptions.hidden = !advanced;
    advancedToggle.setAttribute("aria-expanded", String(advanced));
    advancedToggle.classList.toggle("create-pr-advanced-open", advanced);
});
createButton?.addEventListener("click", () => void submit());
document.addEventListener("keydown", (event) => {
    if (!createPrShortcut(event))
        return;
    event.preventDefault();
    void submit();
});

muxy.lifecycle.onBeforeClose(() => busy);
void initialize();
