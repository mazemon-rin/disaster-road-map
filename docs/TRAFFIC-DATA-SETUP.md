# 交通規制データ接続メモ

## 現在の状態

アプリは `data/traffic-restrictions.json` を読み込み、熊本県内の交通規制を地図上に表示できます。現在のファイルは `source: "未接続"`、`items: []` です。規制がないという意味ではありません。

## JARTICデータの取り込み

JARTICの公開データを取得できるようになった場合、まず公式の利用規約と実データの列名を確認します。その後、全国分のCSVまたはJSONを次のコマンドで熊本県内だけに抽出します。

```bash
node scripts/filter-kumamoto-traffic.mjs input.csv data/traffic-restrictions.json
```

入力の緯度・経度、道路名、規制内容、更新日時、情報元をアプリ用JSONへ変換します。実データの取得先URLや列名は、JARTICの公開ページに表示される最新情報を確認してから設定してください。

## GitHub Actions

現時点では、データの自動取得は有効化していません。JARTICの実ファイルURL・列形式・利用条件が確認できていないためです。

`.github/workflows/validate-traffic-data.yml` は、交通規制JSONの形式をGitHub Actions上で検証します。自動取得を追加する場合は、取得元の許可と形式を確認したうえで、別の更新ワークフローを追加します。

## 国土交通省情報

国土交通省の道路情報提供システムは、公式リンクとしてアプリに追加しています。路面・気象情報を自動表示するには、公開APIまたは利用可能なデータ形式の確認が必要です。
