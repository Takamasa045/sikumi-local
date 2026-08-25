# Observer（今日の作業場）

Shikumi Local の主画面は、各AIアプリから仕事を頼む場所ではありません。
登録した Repository と worktree の様子を、非エンジニア向けの言葉で整理する場所です。

## いま分かること

- 登録した場所に、まだ記録していない変更があるか
- 別作業場（worktree）がいくつあるか
- 変更がどの仕組みに関係しそうか
- 別々の作業場が同じファイルや同じ仕組みを触っていないか
- 衝突の可能性を、かんたんなことばで横断確認できるか

フォルダを登録すれば、そこで今動いている Codex / Claude Code / Cursor / Grok を自分で見つけます。つなぐ（Hooks）は任意です。失敗しても観測は進みます。Git だけで見つかった変更は、画面では「変更元不明」と出します。題名が取れなければ「まだ分かっていません」。

## 衝突エンジン

機械的なルールで、登録した Repository の中の別セッション / 別作業場を比べます。同じセッション自身とは比べません。Git だけで見つかった作業は衝突として出せますが、AI の名前は付けません。

判定の目安:

- 0〜29 安全 / 30〜59 関連あり / 60〜79 調整推奨 / 80〜100 強い競合の可能性
- 画面では数字より 🔴🟠🟡🟢 のことばを使います
- 同じファイルの削除と編集は重大、同じファイル・同じ Schema / API / 設定は強い注意
- 別ファイルでも、経路やファイル名の根拠があるときだけ Schema と API を関係づけます。`src` や `index`、`user` のようなよくある語だけでは結びません
- これは静的な手がかりであり、意味の断定ではありません。AI による意味解析は使いません

共通の起点（merge-base）が取れないときは「不明」と出します。Git の merge / rebase / reset / checkout は行いません。

「確認した」「もう重なっていない」「いまの状態を確認」は提案と記録だけです。自動では取り込みません。

API:

- `GET /api/observer/control-plane` … 誰がどこで何をしているか、確認待ち、止まっている可能、証拠のある衝突、観測の健康、確信度を一つのスナップショットで返す。庭の表示は変えない
- `POST /api/observer/attention/:id/acknowledge` … 「確認した」の記録だけ。AI の起動・停止・commit/push/merge はしない
- `GET /api/conflicts`（`repositoryId` / `source` / `level` / `status` / `unconfirmed`）
- `GET /api/conflicts/:id`
- `POST /api/conflicts/:id/acknowledge`
- `POST /api/conflicts/:id/resolve`
- `POST /api/conflicts/:id/recheck`

変更系は既存の session + CSRF が必要です。Recheck は登録済み Repository の読み取り専用 Git だけを使います。

## 保存しないもの

Prompt、返答、会話全文、hidden reasoning、token、cookie、環境変数、全文 diff は保存しません。

## 上限と復旧

観測は fail-open です。Bridge が書けなくても AI 側の作業は止まりません。

明示している上限の例:

- 1イベント 16KB、1バッチ 50件 / 256KB
- spool 1ファイル 256KB / 500行、1回の取り込み 200ファイルまたは 2000件
- 最近のライブ緩衝 200件
- Git スナップショットはファイル名、行数、変更種別、分類、hash だけ。全文 diff は持たない。1作業場あたり 2000 件まで保存し、超えたときは合計件数を残して省略する
- 衝突比較は側あたり 400 件、組比較 2000 組まで。超えたときは「一部だけを比べています」と出す
- 画面の一覧はファイル 40、セッション 50、衝突 100、場所 100。省略したときは件数の合計を残す
- 30分観測がない作業は stale。協調報告の completed はそのまま残す
- File Watcher は登録した Repository の根だけを見て、Git の再確認を予約する。通知そのものは変更状態にしない
- 定期確認は 30 秒ごと。1回の取り込み上限のまま、残りは次の回で取り込む。タイマーはプロセスを生かし続けない

再起動時は、未処理 spool を取り込み、登録 Repository を再scan し、長いあいだ動いていない作業を stale にし、止まっているあいだの Git 変更は変更元不明として補う。動いているあいだも同じ上限のまま定期確認する。壊れた / 大きすぎる spool は隔離し、あとの正しい行は取り込む。

Portable export に Observer 履歴は含めない。Server の bind は `127.0.0.1` だけ。

## Bridge

`sikumi-observer-bridge <source>` は、各アプリの Hook から呼ばれる軽量コマンドです。
失敗しても AI 側の作業は止めません。データは `~/.shikumi-local/observer/inbox/<source>/` に書きます。

Phase 2 / 3 / 4 / 5 では Codex Hooks、Claude Code Hooks、Cursor Hooks、Grok Build Hook / Plugin を導入できます。つなぐは必須ではありません。導入と解除は preview → 明示ボタンの二段階です。preview はまだ書き込みません。対象 path と差分、plan digest を返します。apply は `confirm: true`、digest 一致、CSRF / ログインが必須です。digest は TOCTOU 検出用で、認可トークンではありません。対象 directory は server が決めます。公開APIは `homeDir` / `repoDir` / `allowRealUserApply` を受けません。条件を満たしたときだけ server が内部で実ユーザー home への適用を許可します。Cursor、Grok Build、Claude Code はユーザー全体と登録 Repository 限定を選べます。Codex はユーザー全体です。Cursor Tab の編集は保存と競合検知に使いますが、トップ画面では時間窓・Repository・path 単位にまとめます。Cursor Cloud Agent は初期対象外です。Grok Build は plugin / trust の記述だけでは ready としません。streaming-json の text / thought / 全文は保存しません。ACP では Grok を起動・管理しません。

Phase 6 の Claudeアプリ通常チャットは制限付きの協調報告です。自動の全チャット観測ではありません。Sikumi は `.mcpb` パッケージを生成・ダウンロードできるだけです。Claude Desktop の Settings > Extensions へ入れる操作はユーザーが行います。Sikumi は Claude Desktop の設定ファイルを読み書きしません。報告がない Git 変更は変更元不明のまま残し、Claude 由来だと断定しません。保存するのは session、登録Repository、resource のメタデータだけです。Prompt、返答、会話全文、ファイル本文、秘密情報は保存しません。

設定ファイルが見つかっただけでは「要レビュー」です。Sikumi が hook event を受信した記録（保存済み `lastEventAt`）があるときだけ「有効」へ昇格します。再確認でその記録は消しません。Prompt、transcript、tool output、command 全文は保存しません。

AI社員に仕事を頼む画面は「庭」です。今日の作業場は観測用で、庭とは別の第一級の画面です。
