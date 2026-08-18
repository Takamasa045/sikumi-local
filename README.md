# Shikumi Local

自分のGit RepositoryにAI社員が住み、仕事を頼むとローカルのAI実行エンジンが働く、小さな庭・工房のWebアプリです。

現在は完全実装計画の **Phase 5〜7: Codex / Grok Build / Claude Code Adapter** です。Job は Provider registry を通り、Workspace → Employee → Job の優先順位で道具を選びます。利用できない道具へは自動fallbackせず、確認後に別Jobとして始めます。実行途中の自動切替はありません。

- Codex: `codex app-server` stdio JSON-RPC が主経路。非互換時のみ `codex exec --json` へcapabilityを下げてfallbackします。
- Grok Build: `grok --no-auto-update agent stdio` ACP が主経路。ACP不可時は `streaming-json`。`--always-approve` と native `--worktree` は使いません。
- Claude Code: `claude -p --output-format stream-json`。`shikumi-permission-broker` MCP で確認画面へつなぎ、`bypassPermissions` は禁止です。CLI認証情報は保存しません。

通常の `pnpm test` は fixture だけで、外部AIを呼びません。インストール済みCLIの read-only 診断だけ見たいときは `node scripts/live-provider-probe.mjs` を使います。Fake は `SIKUMI_LOCAL_ENABLE_FAKE_PROVIDER=1` のときだけ有効で、実Providerとしては表示しません。

## 必要環境

- Node.js 22以上
- pnpm 11.9.0
- Git

## 起動

```bash
pnpm install
pnpm setup
pnpm start
```

ブラウザで <http://127.0.0.1:5184> を開きます。Local Serverは `127.0.0.1:4321` にのみbindし、`pnpm build` 後は `node apps/server/dist/server.js` で起動します。既存の `sikumi` と同時起動できるよう、Web portを分けています。

開発時は `pnpm dev` を使います。

データは `~/.shikumi-local/database.sqlite` に保存します。`SIKUMI_LOCAL_DATA_DIR` で場所を変更できます。

開発用ハーネス（Fake Provider）を明示的に有効にする場合:

```bash
SIKUMI_LOCAL_ENABLE_FAKE_PROVIDER=1 pnpm dev
```

このとき画面には「開発用ハーネス / テスト実行（実エンジン未接続）」と出ます。Codex / Grok Build / Claude Code として偽表示しません。

## 確認

```bash
pnpm doctor
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
pnpm test:smoke
pnpm test:e2e
pnpm run audit
```

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
docs                     計画書と設計資料
scripts                  setup / doctor / live-provider-probe
e2e                      Playwright受け入れテスト
```

Process Runtime は登録済み Git Repository だけを cwd に許可します。shell injection、path traversal、allowlist 外の環境変数は拒否します。cancel / timeout 後に子孫 process を残しません。stdout/stderr の reasoning と secret は永続化しません。

今後は計画書のPhase順に Employee Pack と Worktree 採用を追加します。BrowserからCLIやGitを直接操作せず、すべてLocal Serverを経由します。再起動時に残っていた running Job は process を推測せず orphan / failed にします。

## 初期World Pack

- `dog-office`: 犬たちの里山アトリエ
- `craft-workshop`: 職人工房

どちらも既存の private `sikumi` Repositoryから、Shikumi Localの初期方向確認用に移植しています。出典は [docs/asset-provenance.md](docs/asset-provenance.md) を参照してください。
