# Linear for Muxy

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · **中文**

在 Muxy 侧边栏浏览分配给你的 Linear 问题，一键交给 Claude Code —— 它会创建分支
(可选独立的 git worktree)，并用包含问题上下文的提示词启动你的 agent CLI。

## 功能

- **我的问题面板** —— 按工作流状态分组显示分配给你的问题，并把与当前 git 分支
  匹配的问题固定在顶部。
- **点击问题 → 开始工作** —— 选择分支名(默认使用 Linear 建议的 `branchName`)、
  基础分支、是否使用独立 worktree 以及初始提示词，然后在终端标签中启动 Claude Code。
- **状态变更 & 评论** —— 直接在问题弹窗中操作。
- **创建问题** —— 通过 `Linear: New Issue` 命令面板或面板上的 `+`。

## 初始设置

1. 构建(`npm install && npm run build`)后,在 Muxy 中 **Extensions → Load Unpacked**
   选择构建后的 **`dist/`** 文件夹。
2. 打开面板(顶栏图标或 `Linear: Toggle Sidebar`),然后打开**设置**(⚙)。点击
   **🔑 管理 API 密钥** 注册一个或多个 Linear **Personal API Key**(每个带说明),
   再在设置界面的**下拉框**中选择要使用的密钥
   (Linear → Settings → Security & access → Personal API keys)。完整的初始设置见
   [`docs/setup.md`](docs/setup.md)。
3. 可选地设置默认团队键、基础分支、worktree 位置、agent 命令和提示词模板。
   **🌐 全局 / 📁 本项目** 开关可按仓库覆盖 API 密钥和核心执行值(保存到 `.linear.json`)。
4. 在设置中选择 UI **语言**(English / 한국어 / 日本語 / 中文)。

## 权限

- `panels:write` —— 打开面板和 webview 弹窗。
- `tabs:write` —— 打开运行 agent 的终端标签(首次运行还会请求对自动运行命令的
  运行时同意)。
- `git:read` / `git:write` —— 读取分支以及创建分支/worktree。
- `projects:read` —— 响应项目/分支切换以高亮当前问题。
- `commands:exec` —— 在浏览器中打开问题 URL(`open <url>`)。

Linear API 调用通过 `muxy.http.fetch` 发往 `api.linear.app`,首次使用时会请求主机
同意。API 密钥通过 `muxy.storage` 本地保存。

## 提示词模板占位符

`{identifier}` `{title}` `{branch}` `{url}` `{description}` —— 默认值为
`/리니어 {identifier}`,用于驱动仓库的 Linear 工作技能。

## 许可证

[MIT](LICENSE) © 2026 Namgyeong Kim。

这是一个 **非官方(unofficial)** 扩展,与 Linear 或 Muxy 无隶属、认可或赞助关系。
“Linear”和“Muxy”是各自所有者的商标。
