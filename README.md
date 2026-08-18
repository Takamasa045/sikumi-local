# Shikumi Local

自分の Git Repository に AI 社員が住み、仕事を頼むとローカルの AI 実行エンジンが働く、小さな庭・工房の Web アプリです。

Git clone して、この README だけで起動・診断・backup/restore できます。

## 必要環境

- Node.js 22以上
- pnpm 11.9.0
- Git

## 起動

```bash
git clone <sikumi-local-repository-url>
cd sikumi-local
pnpm install
pnpm setup
pnpm start
```

ブラウザで <http://127.0.0.1:5184> を開きます。Local Server は `127.0.0.1:4321` にのみ bind します。LAN やインターネットへは公開しません。

開発時は `pnpm dev` を使います。

データは `~/.shikumi-local` に保存します。`SIKUMI_LOCAL_DATA_DIR` で場所を変えられます。必ず絶対 path を指定します。symlink は使いません。

## 診断

```bash
pnpm doctor
```

doctor は read-only です。秘密、token、絶対 path は表示しません。
Node.js / pnpm / Git / SQLite / Application Data / 127.0.0.1 bind / Codex / Grok Build / Claude Code を見ます。
通常の `pnpm test` は fixture だけで、外部 AI を呼びません。

## backup / restore

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

## reset

```bash
pnpm data:reset
pnpm data:reset --confirm RESET
```

既定は preview です。`--confirm RESET` が完全一致しないと消しません。
対象データディレクトリを検証し、symlink と repository 本体は拒否します。
先に backup してから、所有エントリだけを消して layout を作り直します。

## 見本 Pack

`examples/packs/example-observer` と `examples/packs/example-garden` は data-only です。
Core / Garden を改修せず、Pack のフォルダ import で導入できます。

## 確認

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
pnpm test:smoke
pnpm test:e2e
pnpm run audit
```

困ったときは [docs/troubleshooting.md](docs/troubleshooting.md) を見てください。

## 構成

```text
apps/web                 庭UI
apps/server              ローカルAPI（127.0.0.1限定）とSQLite
packages/core            Domain型、スキーマ、永続化境界
packages/process-runtime safe spawn と JSONL / timeout / cancel
packages/provider-sdk    Adapter / Capabilities / Events / Approval
packages/provider-codex  Codex app-server / exec --json
packages/provider-grok   Grok ACP / streaming-json
packages/provider-claude Claude stream-json と permission broker
packages/provider-fake   決定的なテスト/開発用ハーネス
examples/packs           導入見本の data-only Employee / World
docs                     計画書、出典、troubleshooting
scripts                  setup / doctor / reset / export / import
e2e                      Playwright受け入れテスト
```

Process Runtime は登録済み Git Repository だけを cwd に許可します。
Browser から CLI や Git を直接操作せず、すべて Local Server を経由します。
再起動時に残っていた running Job は process を推測せず orphan / failed にします。

開発用ハーネス（Fake Provider）を明示的に有効にする場合:

```bash
SIKUMI_LOCAL_ENABLE_FAKE_PROVIDER=1 pnpm dev
```

このとき画面には「開発用ハーネス / テスト実行（実エンジン未接続）」と出ます。

## 初期 World Pack

- `dog-office`: 犬たちの里山アトリエ
- `craft-workshop`: 職人工房

出典は [docs/asset-provenance.md](docs/asset-provenance.md) を参照してください。
