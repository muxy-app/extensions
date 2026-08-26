# Linear for Muxy

[English](README.md) · [한국어](README.ko.md) · **日本語** · [中文](README.zh.md)

Muxy のサイドパネルで自分に割り当てられた Linear の課題を見て、クリック一つで
Claude Code に渡します — ブランチ(任意で専用の git worktree)を作り、課題の
コンテキストを含むプロンプトでエージェント CLI を起動します。

## 機能

- **自分の課題パネル** — 自分に割り当てられた課題をワークフロー状態ごとに
  グループ化し、現在の git ブランチに一致する課題を先頭に固定します。
- **課題をクリック → 作業開始** — ブランチ名(既定は Linear の `branchName` 推奨値)、
  ベースブランチ、専用 worktree を使うか、初期プロンプトを選び、ターミナルタブで
  Claude Code を起動します。
- **状態変更 & コメント** — 課題モーダルから直接。
- **課題の作成** — `Linear: New Issue` パレットコマンドまたはパネルの `+` から。

## セットアップ

1. ビルド(`npm install && npm run build`)後、Muxy で **Extensions → Load Unpacked**
   からビルド済みの **`dist/`** フォルダを選びます。
2. パネルを開き(topbar アイコンまたは `Linear: Toggle Sidebar`)、**設定**(⚙)を
   開きます。**🔑 API キー管理** を押して Linear の **Personal API Key** を(説明付きで)
   一つ以上登録し、設定画面の**ドロップダウン**で使うキーを選びます
   (Linear → Settings → Security & access → Personal API keys)。初期セットアップの
   全体は [`docs/setup.md`](docs/setup.md) を参照してください。
3. 必要に応じて既定のチームキー、ベースブランチ、worktree の場所、エージェント
   コマンド、プロンプトテンプレートを設定します。**🌐 グローバル / 📁 このプロジェクト**
   トグルで API キーと主要な実行値をリポジトリごとに上書きできます(`.linear.json` に保存)。
4. 設定で UI **言語**(English / 한국어 / 日本語 / 中文)を選びます。

## 権限

- `panels:write` — パネルと webview モーダルを開く。
- `tabs:write` — エージェントを実行するターミナルタブを開く(初回は自動実行コマンドの
  ランタイム同意も求めます)。
- `git:read` / `git:write` — ブランチの読み取りとブランチ/worktree の作成。
- `projects:read` — プロジェクト/ブランチの切り替えに反応して現在の課題を強調。
- `commands:exec` — ブラウザで課題の URL を開く(`open <url>`)。

Linear API 呼び出しは `muxy.http.fetch` 経由で `api.linear.app` に送られ、初回使用時に
ホスト同意を求めます。API キーは `muxy.storage` にローカル保存されます。

## プロンプトテンプレートのプレースホルダー

`{identifier}` `{title}` `{branch}` `{url}` `{description}` — 既定値は
`/리니어 {identifier}` で、リポジトリの Linear 作業スキルを駆動します。

## ライセンス

[MIT](LICENSE) © 2026 Namgyeong Kim.

これは **非公式(unofficial)** の拡張であり、Linear や Muxy とは提携・後援関係が
ありません。「Linear」「Muxy」は各所有者の商標です。
