# Shikumi Local 利用者ガイド

この案内は、開発者ではなく、自分のパソコンで Shikumi Local を使う人向けです。

## ことば

| ことば   | 意味                                                              |
| -------- | ----------------------------------------------------------------- |
| 工房     | AI に作業してもらう対象の Git Repository                          |
| AI社員   | 調査や見守りなど、役割を持った専門の担い手                        |
| 道具     | 実際に動く AI 実行エンジン。いまは Codex、Grok Build、Claude Code |
| 別作業場 | 本体の Repository を汚さないための保護用 Git worktree             |
| 成果棚   | レポート、Patch、差分、テスト結果などを受け取る棚                 |

## 最初の起動

この Repository は private です。GitHub へのアクセス権があることを確認してください。

```bash
git clone https://github.com/Takamasa045/sikumi-local.git
cd sikumi-local
pnpm install
pnpm setup
pnpm doctor
pnpm start
```

ブラウザで <http://127.0.0.1:5184> を開きます。同じパソコンのブラウザだけが使えます。

## 普段の起動

```bash
pnpm start
```

## 使い方の流れ

1. 見守りたい Git プロジェクトのフォルダを登録する
2. 普段どおり Codex、Cursor、Grok Build、Claude Code、Claudeアプリなどで作業する。登録したフォルダで動かしている AI は、つなぐ操作なしで庭のその○○番に出ます
3. Shikumi Local の「今日の作業場」で、どこに変更があるかを確認する
4. 衝突注意が出たら「衝突の一覧を見る」から、何が重なりそうかをことばで確認する。おすすめは提案だけです
5. 変更元が分からない場合は「変更元不明」と出ます。AIだと決めません
6. Claudeアプリの通常チャットは制限付きの協調報告です。設定から `.mcpb` を生成し、Claude Desktop の Settings > Extensions へ自分で入れてください。Sikumi は Claude の設定を書き換えません。Tool で報告がない変更は変更元不明のままです
7. 「庭」では、登録した場所が○○番として出ます。そこで動かしている AI がいれば「動いている」になり、クリックで実在情報だけが出ます。題名が分からなければ「まだ分かっていません」

工房に指定するのは、AI 社員に触ってほしいプロジェクトです。Shikumi Local 自身のフォルダではありません。例: `/Users/example/Projects/my-website`

## 実行エンジンの入れ方

入れたい CLI だけ入れてください。1つあれば仕事を頼めます。

- Codex
- Grok Build
- Claude Code

ターミナルでその CLI を一度起動し、自分のアカウントでログインします。画面に戻って「再確認」を押します。

Shikumi Local はログイン情報、token、API key を保存しません。契約、利用上限、API 課金はあなたのアカウントに属します。Shikumi Local は利用料を負担しません。

## つながるもの、つながらないもの

つながる道具:

- Codex
- Grok Build
- Claude Code
- Claudeアプリ（通常チャットは協調報告。自動の全観測ではありません）

まだ adapter がないため選べないもの:

- 任意の CLI
- Gemini CLI
- OpenCode
- Cursor Cloud Agent
- Grok Bot

これは「それらの AI がソースを編集できない」という意味ではありません。Shikumi Local から道具として呼べる口が、まだないという意味です。

## なぜスマートフォンからは使えないか

Local Server は `127.0.0.1` にだけ bind します。同じパソコンのブラウザ専用です。LAN 越しのスマホ操作や遠隔操作はありません。

Prompt、返答、会話全文、token、全文 diff は保存しません。変更が多いときは件数の合計は残し、一覧は一部だけ出します。アプリを再起動しても、止まっているあいだの Git 変更は「変更元不明」として見つかります。

## 開発用ハーネス

開発や受け入れテストでは Fake Provider を使います。画面には「開発用ハーネス」と出ます。Codex / Grok Build / Claude Code には見せません。
