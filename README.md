# Shikumi Local

登録した場所の様子を、観測の庭で見るローカルアプリです。仕事の依頼は各 AI 側で行い、庭は様子を見ます。

## できること

- Git のフォルダを場所として登録する。しくみローカル自身のフォルダでなくてよい
- 庭（<http://127.0.0.1:5184/#garden>）に、登録した場所がキャラとして出る
- 管制所（<http://127.0.0.1:5184/#control-room>）で、今日の作業の要約・確認が必要・動いている仕事を見る。動かすボタンはない
- 動いている仕事は歩く。吹き出しは日常語（場所の説明と、いまの仕事の中身）。ファイル名、SHA、git の用語は出さない
- キャラをクリックすると、いま／次／この場所は何の仕事か／これまでの仕事が見える。長いときはスクロールする。縁側などの家具名は出さない
- Codex / Claude Code / Grok / CLI は、登録した場所で動いていれば庭に出る。つなぐ（Hooks）は任意で、必須ではない
- 里山と工房の見た目を選べる
- 届ける場所には、届いた仕事だけがいる。途中の仕事は置かない
- 設定で場所の追加・削除とフォルダ選択ができる。Windows でも場所を選べる

ブラウザから CLI や Git を直接操作しません。すべてはこのパソコン上の Local Server 経由です。

## 必要なもの

- Node.js 22以上
- pnpm 11.9.0
- Git
- 各 AI の CLI は任意。庭を見るだけなら不要です

しくみローカルは認証情報を保存しません。契約や利用料は、各 AI 側のアカウントに属します。

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

ブラウザで <http://127.0.0.1:5184> を開きます。庭は <http://127.0.0.1:5184/#garden> です。

Local Server は `127.0.0.1:4321` にのみ bind します。同じパソコンのブラウザだけが使えます。LAN やスマートフォンからの遠隔操作はしません。

## はじめてのとき

1. 見守りたい Git プロジェクトのフォルダを登録する。しくみローカル自身のフォルダでなくてよい。
2. 庭を開く。登録した場所がキャラとして出ます。

場所の追加・削除は、設定と今日の作業場からできます。「フォルダを選ぶ」が使えないときは、場所のパスを貼っても大丈夫です。

## 普段の起動

```bash
pnpm start
```

開発時は `pnpm dev` を使います。

データは `~/.shikumi-local` に保存します。`SIKUMI_LOCAL_DATA_DIR` で場所を変えられます。必ず絶対 path を指定します。symlink は使いません。

## バックアップ

```bash
pnpm data:export --preview
pnpm data:export --out /absolute/path/shikumi-local.json
pnpm data:export --out /absolute/path/shikumi-local.json --overwrite
pnpm data:import --from /absolute/path/shikumi-local.json
pnpm data:import --from /absolute/path/shikumi-local.json --confirm IMPORT
```

export は持ち出せる JSON です。秘密や絶対 path があれば書き出さず失敗します。
既存の通常ファイルは、置き換えるときだけ `--overwrite` が必要です。

import は既定が preview です。`--confirm IMPORT` が完全一致したときだけ取り込みます。
既存データは自動 backup し、失敗したら戻します。

```bash
pnpm data:reset
pnpm data:reset --confirm RESET
```

既定は preview です。`--confirm RESET` が完全一致しないと消しません。

## 困ったとき

```bash
pnpm doctor
```

doctor は読むだけです。秘密、token、絶対 path は表示しません。
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

開発用ハーネス（Fake Provider）を明示的に有効にする場合:

```bash
SIKUMI_LOCAL_ENABLE_FAKE_PROVIDER=1 pnpm dev
```

このとき画面には「開発用ハーネス」と「テスト実行」と出ます。本番の依頼エンジンではありません。

## 内部構成

```text
apps/web                 観測の庭などの画面
apps/server              このパソコンだけの API と保存
packages/core            型と保存の境目
packages/observer-*      場所の様子を見る口
packages/process-runtime 外部コマンドの安全な起動
packages/provider-*      開発・互換用の接続口
examples/packs           見本の Pack
docs                     出典と困ったとき
scripts                  setup / doctor / バックアップ
e2e                      画面の受け入れテスト
```

## 初期 World Pack

- `dog-office`: 犬たちの里山アトリエ
- `craft-workshop`: 職人工房

出典は [docs/asset-provenance.md](docs/asset-provenance.md) を参照してください。
