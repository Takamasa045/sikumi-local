# Shikumi Local

複数の AI アプリが触ったローカル Repository の様子を、横断して眺めるためのローカルアプリです。仕事の依頼は各 AI アプリ側で行い、Shikumi Local は観測と整理を担当します。

## できること

- 自分の Git プロジェクトを登録し、変更と別作業場を一覧する
- Codex / Claude Code の公式 Hooks から、許可したメタデータだけを受け取る
- Claudeアプリの通常チャットは、協調報告用の `.mcpb` をユーザーが入れる制限付き対応です。自動の全観測ではありません
- どの場所で何が動いているかを、専門用語を減らして確認する
- 同じ仕組みを別作業が触っているときの注意を見る
- 「庭」で AI社員に仕事を頼む
- 確認が必要な操作だけ承認する
- 調査レポート、差分、テスト結果などを成果棚で受け取る

ブラウザから CLI や Git を直接操作しません。すべてはこのパソコン上の Local Server 経由です。

## 必要なもの

- Node.js 22以上
- pnpm 11.9.0
- Git
- 使いたい AI 実行エンジンの CLI（Codex、Grok Build、Claude Code のどれか1つで足ります）

契約、利用上限、API 課金は、各 CLI にログインしているあなた自身のアカウントに属します。Shikumi Local は認証情報を保存せず、利用料を肩代わりしません。

## 最短起動

この Repository は private です。clone するには GitHub へのアクセス権が必要です。

```bash
git clone https://github.com/Takamasa045/sikumi-local.git
cd sikumi-local
pnpm install
pnpm setup
pnpm doctor
pnpm start
```

ブラウザで <http://127.0.0.1:5184> を開きます。

Local Server は `127.0.0.1:4321` にのみ bind します。同じパソコンのブラウザだけが使えます。LAN やスマートフォンからの遠隔操作はしません。

## 初回設定

1. 工房にする Git プロジェクトのフォルダを登録する。Shikumi Local 自身のフォルダではありません。
2. 使いたい実行エンジンの CLI を入れ、ターミナルで一度ログインする。
3. 画面の「再確認」で接続を確かめてから、AI 社員に仕事を頼む。

くわしい手順は [docs/user-guide.md](docs/user-guide.md) を見てください。

## 普段の起動

```bash
pnpm start
```

開発時は `pnpm dev` を使います。

データは `~/.shikumi-local` に保存します。`SIKUMI_LOCAL_DATA_DIR` で場所を変えられます。必ず絶対 path を指定します。symlink は使いません。

## AI実行エンジンの接続

対応している道具は次の3つです。

- Codex
- Grok Build
- Claude Code

使いたい CLI だけ入れれば十分です。自分のアカウントでログインします。Shikumi Local は token や API key をコピーしません。

まだ adapter を実装していないため、次は道具として選べません。

- 任意の CLI
- Gemini CLI
- OpenCode
- Cursor Cloud Agent
- Grok Bot

これは「その AI がソースを編集できない」という意味ではありません。Shikumi Local 側の接続口がない、という意味です。

自動で別の道具へ切り替えることはしません。道具を変えるときは、画面で明示的に確認します。

開発用ハーネス（Fake Provider）を明示的に有効にする場合:

```bash
SIKUMI_LOCAL_ENABLE_FAKE_PROVIDER=1 pnpm dev
```

このとき画面には「開発用ハーネス」と「テスト実行」と出ます。実エンジンには見せません。

## 基本的な使い方

1. 工房（対象の Git Repository）を登録する
2. AI 社員を選ぶ
3. 道具を選ぶ。標準が未設定なら依頼ごとに選びます
4. 日本語で依頼する
5. 必要な確認だけ承認する
6. 成果棚で結果を見る

## 成果の受け取り方

成果棚にはレポート、Markdown、差分、テスト結果などが並びます。

- 「内容を見る」で本文を読む。HTML としては描画しません
- Patch は現在の branch へ適用、書き出し、別作業場の保持 / 破棄ができます
- 1 MiB を超える本文は一部だけ表示します

## バックアップ

```bash
pnpm data:export --preview
pnpm data:export --out /absolute/path/shikumi-local.json
pnpm data:export --out /absolute/path/shikumi-local.json --overwrite
pnpm data:import --from /absolute/path/shikumi-local.json
pnpm data:import --from /absolute/path/shikumi-local.json --confirm IMPORT
```

export は versioned な portable JSON（ディレクトリを渡すと `shikumi-portable.json`）です。
秘密、reasoning、絶対 path があれば書き出さず失敗します。サイズ上限があります。書き込みは原子的です。
既存の通常ファイルは暗黙上書きしません。置き換えるときは `--overwrite` が必要です。

import は既定が preview です。`--confirm IMPORT` が完全一致したときだけ取り込みます。
既存データは自動 backup し、失敗したら rollback します。
`--from` は絶対 path の通常ファイル（またはそのディレクトリ）です。symlink 祖先は拒否します。

```bash
pnpm data:reset
pnpm data:reset --confirm RESET
```

既定は preview です。`--confirm RESET` が完全一致しないと消しません。

## 困ったとき

```bash
pnpm doctor
```

doctor は read-only です。秘密、token、絶対 path は表示しません。
Node.js / pnpm / Git / SQLite / Application Data / 127.0.0.1 bind は必須です。
Codex / Grok Build / Claude Code は任意です。未インストールでも doctor 全体は失敗しません。

通常の `pnpm test` は fixture だけで、外部 AI を呼びません。

困ったときは [docs/troubleshooting.md](docs/troubleshooting.md) を見てください。

## 開発者向け確認コマンド

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
pnpm test:smoke
pnpm test:e2e
pnpm run audit
pnpm doctor
```

## 内部構成

```text
apps/web                 庭UI
apps/server              ローカルAPI（127.0.0.1限定）とSQLite
packages/core            Domain型、スキーマ、永続化境界
packages/process-runtime safe spawn と JSONL / timeout / cancel
packages/provider-sdk    Adapter / Capabilities / Events / Approval
packages/provider-codex  Codex app-server / exec --json
packages/provider-grok   Grok ACP / streaming-json
packages/provider-claude Claude stream-json と permission broker
packages/observer-cursor Cursor Hooks 観測口
packages/observer-grok   Grok Build Hook / Plugin 観測口
packages/provider-fake   決定的なテスト/開発用ハーネス
examples/packs           導入見本の data-only Employee / World
docs                     計画書、出典、troubleshooting、利用者向け案内
scripts                  setup / doctor / reset / export / import
e2e                      Playwright受け入れテスト
```

Process Runtime は登録済み Git Repository だけを cwd に許可します。
再起動時に残っていた running Job は process を推測せず orphan / failed にします。

## 見本 Pack

`examples/packs/example-observer` と `examples/packs/example-garden` は data-only です。
Core / Garden を改修せず、Pack のフォルダ import で導入できます。

## 初期 World Pack

- `dog-office`: 犬たちの里山アトリエ
- `craft-workshop`: 職人工房

出典は [docs/asset-provenance.md](docs/asset-provenance.md) を参照してください。
