# Shikumi Local

自分のGit RepositoryにAI社員が住み、仕事を頼むとローカルのAI実行エンジンが働く、小さな庭・工房のWebアプリです。

現在は完全実装計画の **Phase 2: DomainとSQLite** です。Workspace / Repository / Employee / Provider / Job / Run / Event / Approval / Artifact / Growth / Pack の型と SQLite 永続化、ローカル Git Repository の登録までが動きます。AI実行、承認、成果の採用はまだ接続していません。画面上でも実行エンジンが未接続であることを明示しています。

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
apps/web       庭UI
apps/server    ローカルAPI（127.0.0.1限定）とSQLite
packages/core  Domain型、スキーマ、永続化境界
docs           計画書と設計資料
scripts        setup / doctor
e2e            Playwright受け入れテスト
```

今後は計画書のPhase順に、Process Runtime、Provider Adapter、Employee Packを追加します。BrowserからCLIやGitを直接操作せず、すべてLocal Serverを経由します。

## 初期World Pack

- `dog-office`: 犬たちの里山アトリエ
- `craft-workshop`: 職人工房

どちらも既存の private `sikumi` Repositoryから、Shikumi Localの初期方向確認用に移植しています。出典は [docs/asset-provenance.md](docs/asset-provenance.md) を参照してください。
