import { activeWorktreePath, samePath, setActiveRepo } from "@/lib/git";
import { listRepos, setWorkspaceRoot, workspaceRoot } from "@/lib/workspace";
import { chooseFolder } from "@/ui/folder-picker";
import { h } from "@/lib/dom";
import { icon } from "@/lib/icons";

const CHANGE_ROOT = "__change_root__";

export async function openRepoPicker() {
    const root = await workspaceRoot();
    if (!root)
        return;
    const [repos, current] = await Promise.all([listRepos(root), activeWorktreePath()]);
    const items = repos.map((repo) => ({
        id: repo.path,
        title: current && samePath(repo.path, current) ? `${repo.name}  ✓` : repo.name,
        subtitle: [repo.rel !== repo.name ? repo.rel : "", repo.branch, repo.dirty ? `${repo.dirty} changed` : ""]
            .filter(Boolean)
            .join("  ·  "),
    }));
    items.push({ id: CHANGE_ROOT, title: "Change workspace folder…", subtitle: root });
    const picked = await muxy.modal.open({ items, placeholder: "Switch repository…" });
    if (!picked)
        return;
    if (picked.id === CHANGE_ROOT) {
        const folder = await chooseFolder(root, "Choose workspace folder");
        if (folder) {
            await setWorkspaceRoot(folder);
            await openRepoPicker();
        }
        return;
    }
    await setActiveRepo(picked.id);
}

export function renderRepoSwitcher(app) {
    return h("button", {
        type: "button",
        class: "flex h-8 w-full items-center gap-1.5 border-b border-border px-2.5 text-[12px] text-foreground outline-none hover:bg-accent",
        onclick: () => void openRepoPicker(),
    }, icon("folderGit", 13, "text-muted-foreground", 2), h("span", { class: "truncate font-medium" }, app.repoName || "Repository"), icon("chevronDown", 12, "ml-auto text-muted-foreground", 2.5));
}
