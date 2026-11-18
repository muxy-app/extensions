/* Folder add flow: scan a folder for git repositories and submodules, then register the chosen ones. */
const SCAN_DEPTH = 5;
const PRUNE = ["node_modules", ".venv", "Pods", "vendor", ".next", "dist", "build", "target"];

/* ---------- add folder ---------- */

async function scanRepos(root) {
  const prune = PRUNE.flatMap((n, i) => (i ? ["-o", "-name", n] : ["-name", n]));
  const result = await muxy.exec(
    [
      "find", root, "-maxdepth", String(SCAN_DEPTH),
      "(", ...prune, ")", "-prune", "-o",
      "-name", ".git",
      "(", "-type", "d", "-exec", "printf", "D\t%s\n", "{}", ";",
      "-o", "-type", "f", "-exec", "grep", "-H", "^gitdir:", "{}", ";", ")",
    ],
    { timeoutMs: 60000 }
  );
  const found = [];
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("D\t")) {
      found.push({ path: norm(line.slice(2).replace(/\/\.git$/, "")), kind: "repo" });
    } else if (line.includes("/.git:gitdir:")) {
      const [gitFile, target] = line.split(":gitdir:");
      const path = norm(gitFile.replace(/\/\.git$/, ""));
      // worktree checkouts are already reachable through their main repo
      if (target.includes("/worktrees/")) continue;
      found.push({ path, kind: "submodule" });
    }
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

/* Folder add = Muxy's built-in "Open Project…" window (header button and every workspace's "＋" alike).
 * That command reports nothing back and takes no start folder, so a newly added project is detected by comparing
 * the project list before and after; it then goes into the workspace the button belongs to, and repositories or
 * submodules found inside it are offered. */
let addWatch = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function addFolder(groupID) {
  const token = (addWatch = Symbol("add"));
  const before = new Set((await muxy.projects.list()).map((p) => p.id));
  try {
    await muxy.commands.run("add_project");
  } catch (err) {
    await muxy.dialog.alert({ title: tr("프로젝트 열기 창을 열지 못했어요"), message: String((err && err.message) || err) });
    return;
  }
  // the window stays open until the user decides; give up after 3 minutes or when another add starts
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline && addWatch === token) {
    await sleep(1000);
    const added = (await safe(() => muxy.projects.list(), [])).filter((p) => !before.has(p.id));
    if (added.length) { await adoptAdded(added, groupID); return; }
  }
}

async function adoptAdded(added, groupID) {
  await refreshProjects();
  if (groupID && groupID !== UNGROUPED) for (const p of added) await muxy.projects.attach(p.id, groupID);
  await refreshMembers();
  for (const p of added) {
    const found = await safe(() => scanRepos(norm(p.path)), []);
    // the picked folder itself is already a project; only its contents are worth offering
    if (found.some((f) => norm(f.path) !== norm(p.path))) { openAddDialog(norm(p.path), found, groupID || UNGROUPED); break; }
  }
}

function openAddDialog(root, found, presetGroupID) {
  const existing = new Map(data.projects.map((p) => [norm(p.path), p]));
  const checks = found.map((f) => {
    const already = existing.has(f.path);
    const box = el("input", { type: "checkbox", checked: !already, disabled: already });
    return { f, already, box };
  });

  const rel = (path) => (path === root ? base(root) + tr(" (루트)") : path.slice(root.length + 1));
  const list = el(
    "div", { class: "found" },
    checks.map(({ f, already, box }) =>
      el(
        "label", { class: already ? "off" : "" },
        box,
        el("span", { class: "text" }, el("div", { class: "name" }, rel(f.path))),
        already ? el("span", { class: "badge" }, tr("추가됨")) : null,
        f.kind === "submodule" ? el("span", { class: "badge" }, "submodule") : null
      )
    )
  );

  const select = el("select", {}, ...data.workspaces.map((g) => el("option", { value: g.id }, g.name)), el("option", { value: "__new__" }, tr("＋ 새 그룹")), el("option", { value: UNGROUPED }, tr("미분류")));
  const newName = el("input", { type: "text", value: base(root), placeholder: tr("새 그룹 이름") });
  const nameField = el("label", { class: "field" }, tr("새 그룹 이름"), newName);
  const sync = () => { nameField.hidden = select.value !== "__new__"; };
  select.value = presetGroupID || UNGROUPED;
  select.addEventListener("change", sync);
  sync();

  const status = el("div", { class: "path" });
  const addBtn = el("button", { class: "primary" }, tr("추가"));
  const close = () => { $("#overlay").hidden = true; $("#overlay").replaceChildren(); };

  addBtn.addEventListener("click", async () => {
    const chosen = checks.filter((c) => !c.already && c.box.checked).map((c) => c.f);
    if (chosen.length === 0) { close(); return; }
    addBtn.disabled = true;

    let groupID = select.value;
    if (groupID === "__new__") {
      const g = await createGroup(newName.value || base(root));
      groupID = g ? g.id : UNGROUPED;
    }
    let done = 0;
    for (const f of chosen) {
      status.textContent = tr("추가 중… {0}/{1}", done + 1, chosen.length);
      try {
        const id = await muxy.projects.add(f.path);
        state.kinds[id] = { kind: f.kind, root };
        if (groupID !== UNGROUPED) await muxy.projects.attach(id, groupID);
        done++;
      } catch (err) {
        console.error("add failed", f.path, err);
      }
    }
    await save();
    close();
    await refreshProjects();
    await refreshMembers();
    if (done < chosen.length) {
      muxy.dialog.alert({ title: tr("일부만 추가됐어요"), message: tr("{0}개 중 {1}개를 추가했어요. 로그를 확인해 주세요.", chosen.length, done) });
    }
  });

  const dialog = el(
    "div", { class: "dialog" },
    el("h3", {}, tr("저장소 {0}개를 찾았어요", found.length)),
    el("div", { class: "path" }, root),
    list,
    el("label", { class: "field" }, tr("추가할 그룹"), select),
    nameField,
    status,
    el("div", { class: "actions" }, el("button", { class: "ghost", onclick: close }, tr("취소")), addBtn)
  );
  const overlay = $("#overlay");
  overlay.replaceChildren(dialog);
  overlay.hidden = false;
}

