import { clear, h } from "@/lib/dom";
import { icon } from "@/lib/icons";
import { footer, heading } from "@/pr-checkout/ui";

const OPTIONS = [
    { id: "default", icon: "branchPlus", title: "Checkout in default worktree", description: "Switch the repository's default worktree to the pull request branch." },
    { id: "worktree", icon: "folderGit", title: "Checkout as a new worktree", description: "Create a sibling worktree and switch Muxy to it." },
];

export class CheckoutView {
    root;
    pr;
    path;
    selected = 0;
    busy = false;
    label = "";
    onBack;
    onChoose;
    constructor(root, pr, path, { onBack, onChoose }) {
        this.root = root;
        this.pr = pr;
        this.path = path;
        this.onBack = onBack;
        this.onChoose = onChoose;
    }
    render() {
        const options = h("div", { class: "pr-choice-options", role: "listbox", "aria-label": "Checkout options" }, OPTIONS.map((option, index) => this.option(option, index)));
        const shell = h("main", { class: `pr-modal pr-choice${this.busy ? " pr-modal-busy" : ""}`, tabindex: -1 }, heading(`Checkout PR #${this.pr.number}`, this.pr.title, "branchPlus", this.onBack), h("section", { class: "pr-choice-body" }, h("div", { class: "pr-choice-branch" }, h("span", {}, this.pr.headBranch || "pull request branch"), h("span", {}, "→"), h("span", {}, this.pr.baseBranch || "default")), options), footer(this.busy ? this.label : "Choose where to check out this pull request", [["↑↓", "Navigate"], ["↵", "Choose"], ["←", "Back"]]));
        clear(this.root);
        this.root.appendChild(shell);
        shell.focus();
    }
    option(option, index) {
        const description = option.id === "worktree" && this.path
            ? `${option.description} ${this.path}`
            : option.description;
        return h("button", {
            type: "button",
            class: `pr-choice-option${index === this.selected ? " pr-choice-option-selected" : ""}`,
            role: "option",
            "aria-selected": index === this.selected,
            disabled: this.busy,
            onpointermove: () => this.select(index),
            onclick: () => {
                this.select(index);
                this.onChoose(option.id);
            },
        }, h("span", { class: "pr-choice-icon" }, icon(option.icon, 14, "", 2)), h("span", { class: "pr-choice-copy" }, h("strong", {}, option.title), h("span", {}, description)), h("kbd", {}, "↵"));
    }
    handleKey(event) {
        if (this.busy)
            return false;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            this.select((this.selected + (event.key === "ArrowDown" ? 1 : -1) + OPTIONS.length) % OPTIONS.length);
            return true;
        }
        if (event.key === "Enter") {
            this.onChoose(OPTIONS[this.selected].id);
            return true;
        }
        return false;
    }
    select(index) {
        if (this.selected === index)
            return;
        this.selected = index;
        this.render();
    }
    setBusy(busy, label = "") {
        this.busy = busy;
        this.label = label;
        this.render();
    }
}
