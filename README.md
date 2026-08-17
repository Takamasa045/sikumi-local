# Shikumi Local

自分のGit RepositoryにAI社員が住み、仕事を頼むとローカルのAI実行エンジンが働く、小さな庭・工房のWebアプリです。

現在は完全実装計画の **Phase 1: Repository Skeleton** です。React/Viteの庭UI、Fastifyのローカルサーバー、テスト基盤と2つの初期World Packを収録しています。AI実行、Repository登録、承認、履歴保存はまだ接続していません。画面上でも未接続であることを明示しています。

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

ブラウザで <http://127.0.0.1:5184> を開きます。Local Serverは `127.0.0.1:4321` にのみbindします。既存の `sikumi` と同時起動できるよう、Web portを分けています。

開発時は `pnpm dev` を使います。

## 確認

```bash
pnpm doctor
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
pnpm test:e2e
```

## 構成

```text
apps/web       庭UI
apps/server    ローカルAPI（127.0.0.1限定）
docs           計画書と設計資料
scripts        setup / doctor
e2e            Playwright受け入れテスト
```

今後は計画書のPhase順に、Domain/SQLite、Process Runtime、Provider Adapter、Employee Packを追加します。BrowserからCLIやGitを直接操作せず、すべてLocal Serverを経由します。

## 初期World Pack

- `dog-office`: 犬たちの里山アトリエ
- `craft-workshop`: 職人工房

どちらも既存の private `sikumi` Repositoryから、Shikumi Localの初期方向確認用に移植しています。出典は [docs/asset-provenance.md](docs/asset-provenance.md) を参照してください。
