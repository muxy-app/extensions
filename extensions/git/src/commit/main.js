import * as repo from "@/lib/repo";
import { changedFileCount, changesLabel, commitShortcut, errorMessage } from "./model";
import "./commit.css";

const message = document.querySelector("#message");
const branch = document.querySelector("#branch");
const changes = document.querySelector("#changes");
const status = document.querySelector("#status");
const commitButton = document.querySelector("#commit");
const commitPushButton = document.querySelector("#commit-push");
const commitPushLabel = commitPushButton?.querySelector(".button-label");

let ready = false;
let changeCount = 0;
let busy = false;
let committed = false;
let commitHash = "";

function setStatus(text, tone = "") {
    status.textContent = text;
    status.title = text;
    status.className = `commit-status${tone ? ` commit-status-${tone}` : ""}`;
}

function syncControls() {
    const hasMessage = message.value.trim().length > 0;
    const canCommit = ready && changeCount > 0 && hasMessage && !busy && !committed;
    const canPush = committed ? !busy : canCommit;

    message.disabled = busy || committed;
    commitButton.disabled = !canCommit;
    commitPushButton.disabled = !canPush;
    commitPushLabel.textContent = committed ? "Retry Push" : "Commit & Push";
    document.body.classList.toggle("commit-is-busy", busy);
}

function changePaths(statusSnapshot) {
    changeCount = changedFileCount(statusSnapshot);
    changes.lastElementChild.textContent = changesLabel(changeCount);
    changes.classList.toggle("commit-changes-empty", changeCount === 0);
}

async function initialize() {
    try {
        const snapshot = await muxy.git.status({ local: true, fresh: true });
        branch.textContent = snapshot.branch || "Detached HEAD";
        branch.title = branch.textContent;
        changePaths(snapshot);
        ready = true;
    }
    catch (error) {
        changes.lastElementChild.textContent = "Changes unavailable";
        changes.classList.add("commit-changes-empty");
        setStatus(`Could not load changes: ${errorMessage(error)}`, "error");
    }
    finally {
        syncControls();
        message.focus();
    }
}

async function notifySuccess(pushed) {
    const shortHash = commitHash ? ` · ${commitHash.slice(0, 7)}` : "";
    await muxy.notifications.notify({
        title: pushed ? "Committed and pushed" : "Changes committed",
        body: `${message.value.trim()}${shortHash}`,
    }).catch(() => undefined);
}

async function runAction(push) {
    if (busy || !ready || changeCount === 0 || !message.value.trim())
        return;
    if (committed && !push)
        return;

    busy = true;
    setStatus(committed ? "Pushing…" : push ? "Staging, committing, and pushing…" : "Staging and committing…");
    syncControls();

    try {
        if (!committed) {
            const result = await repo.commit({ message: message.value.trim(), stageAll: true });
            committed = true;
            commitHash = result?.hash ?? "";
        }
        if (push)
            await repo.push();

        setStatus(push ? "Committed and pushed" : "Committed", "success");
        await notifySuccess(push);
        muxy.lifecycle.close();
    }
    catch (error) {
        const detail = errorMessage(error);
        if (committed && push)
            setStatus(`Committed, but push failed: ${detail}`, "error");
        else
            setStatus(`Commit failed: ${detail}`, "error");
    }
    finally {
        busy = false;
        syncControls();
    }
}

message?.addEventListener("input", () => {
    if (!busy)
        setStatus("");
    syncControls();
});
commitButton?.addEventListener("click", () => void runAction(false));
commitPushButton?.addEventListener("click", () => void runAction(true));
document.addEventListener("keydown", (event) => {
    const action = commitShortcut(event);
    if (!action)
        return;
    event.preventDefault();
    void runAction(action === "commit-and-push");
});

muxy.lifecycle.onBeforeClose(() => busy);
void initialize();
