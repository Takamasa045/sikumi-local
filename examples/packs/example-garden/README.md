# example-garden

見本の World Pack です。データのみで構成されています。

Zip の中身は次のとおりです。

```text
world.yaml
background.png
characters.png
```

- `world.yaml` — 名前と、庭が使う絵の場所
- `background.png` — 庭の背景
- `characters.png` — 歩く人の絵（3列×4行の一枚絵。組み込みの里山・工房と同じ割り方）

JavaScript、Shell、実行ファイルは入れません。
画像は Pack の直下（`world.yaml` と同じ場所）に置きます。webp / png / jpg / gif が使えます。

## 入れ方

1. 下の手順で Zip を作る（または届いた Zip を使う）
2. アプリの設定を開く
3. 「Packを確認して追加」で入手元を Zip にする
4. Zip の場所を入れて、確認して導入する
5. 庭の「里山 / 工房」の横に「見本」が出る

## Zip の作り方

```bash
node examples/packs/example-garden/build-zip.mjs
```

同じフォルダに `example-garden.zip` ができます。フォルダのまま導入しても同じです。
