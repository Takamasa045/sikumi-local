# Troubleshooting

Shikumi Local は Git clone して使うローカルアプリです。Server は `127.0.0.1` にだけ bind します。

## 起動できない

1. Node.js 22 以上と pnpm 11.9.0 があるか確認する。
2. `pnpm install`
3. `pnpm setup`
4. `pnpm doctor`
5. `pnpm start`
6. ブラウザで <http://127.0.0.1:5184> を開く。

`pnpm start` は先に build します。Web は `127.0.0.1:5184`、Server は `127.0.0.1:4321` です。

## doctor が赤い

- `× Node.js` / `× pnpm` / `× Git` — 必須ツールです。入れてから再実行します。
- `△ Codex` / `△ Grok Build` / `△ Claude Code` — 未インストールでも起動できます。使うときだけ入れます。
- Application Data が writable でない — `SIKUMI_LOCAL_DATA_DIR` を書き込める場所に変えます。
- doctor は read-only です。秘密や絶対 path は表示しません。

## ポートが使われている

別プロセスが `5184` か `4321` を使っています。止めてから `pnpm start` します。
`0.0.0.0` や LAN 公開はしません。`SIKUMI_LOCAL_HOST` は `127.0.0.1` 以外を受け付けません。

## Observer が古い、または多すぎる

再起動すると未処理 spool を取り込み、登録 Repository を再scan します。動いているあいだも 30 秒ごとの確認で、同じ上限のまま残りを取り込みます。壊れた / 大きすぎる spool は `observer/failed` に隔離し、あとの正しい行は取り込みます。30分動きがない作業は stale です。完了した協調報告はそのままです。

変更が多すぎるときは件数の合計は残し、一覧は省略します。「一部だけ表示」と出ます。全文 diff や Prompt は保存しません。

## データ場所

既定は `~/.shikumi-local` です。

```bash
SIKUMI_LOCAL_DATA_DIR=/absolute/temp/dir pnpm setup
```

symlink のデータディレクトリは拒否します。テストは temp ディレクトリだけを使います。

## backup / restore

```bash
# 中身だけ見る
pnpm data:export --preview
pnpm data:import --from /absolute/path/shikumi-local.json

# いまのデータを持ち出せる形で書き出す
pnpm data:export --out /absolute/path/shikumi-local.json

# 同じ場所へ書き直すときだけ
pnpm data:export --out /absolute/path/shikumi-local.json --overwrite

# 取り込む。既存データは自動 backup してから置き換える
pnpm data:import --from /absolute/path/shikumi-local.json --confirm IMPORT
```

export は秘密、reasoning、絶対 path を含めません。サイズ上限を超えると失敗します。
既存ファイルの暗黙上書きはしません。
import は既定が preview です。`--confirm IMPORT` が完全一致しないと書き込みません。
失敗したときは backup から戻します。

## reset

```bash
# 何が消えるかだけ見る
pnpm data:reset

# 実行する。確認文字列は RESET だけ
pnpm data:reset --confirm RESET
```

reset は対象データディレクトリを検証し、symlink と repository 本体を拒否します。
実行前に `backups/reset-*` へコピーしてから、所有エントリだけを消します。

## Pack を足したい

`examples/packs/example-observer` と `examples/packs/example-garden` が data-only の見本です。
画面の Pack import にフォルダを渡します。任意コードは実行しません。

## よくある失敗

- export/import の path に `..` や symlink を使う — 拒否されます。絶対 path の通常ファイル/ディレクトリを使います。
- confirm を `reset` や `import` と書く — 大文字の `RESET` / `IMPORT` だけが通ります。
- Fake Provider を本番の道具として使おうとする — `SIKUMI_LOCAL_ENABLE_FAKE_PROVIDER=1` のときだけ開発用ハーネスです。

## 実 Provider の仕事が始まらない / 途中で止まる

- 工房は Shikumi Local 自身ではなく、別の Git Repository を登録します。
- Grok Build / Codex の JSON-RPC は、返事のない request を放置しません。仕事の制限時間は既定 15 分です。
- Grok の ACP は `session/new` に `mcpServers` を渡し、最終 JSON は Schema に合う最後のオブジェクトだけを成果にします。
- いま動いている Grok プロセスの中から、同じ Grok を入れ子で起動すると失敗することがあります。そのときは別ターミナルから compiled server（`pnpm --filter @sikumi-local/server start`）で確認します。
- 通常の `pnpm test` は fixture だけです。Codex / Claude Code の実 Job は資格情報を使うため、この案内では成功とは書きません。

## Observer の導入 preview が出ない

Hook コマンドの絶対 path に `;` や `$()` があると拒否します。ディレクトリ名に `*` がある場合は、そのファイルが実在するときだけ preview できます。存在しない glob は拒否します。
