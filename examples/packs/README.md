# Example Packs

データだけの見本です。アプリのコードは変えません。

- `example-observer` — 見守り担当の Employee Pack
- `example-garden` — 庭の見た目（背景と歩く人の絵）を足す World Pack

庭の見た目は Zip で渡します。設定の「Packを確認して追加」で入手元を Zip にし、Zip の場所を入れて確認して導入します。
フォルダや Git からも入れられます。

JavaScript、Shell、postinstall、実行ファイルは含めません。
庭の絵は webp / png / jpg / gif です。作り方は `example-garden` を見てください。
Zip を作るときは `node examples/packs/build-example-garden-zip.mjs` です。スクリプトは Pack の外に置いてあります。
