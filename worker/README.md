# 交通量API Worker中継

## 役割

Cloudflare WorkerがGitHub PagesとxROAD/JARTIC交通量APIの間を中継します。WorkerはGETだけを受け付け、request body、Authorization、Content-Typeのリクエストヘッダーを付けずに公式APIへGETします。

## 初回設定

1. CloudflareでWorkerプロジェクトを作成します。
2. `wrangler.toml.example`を`wrangler.toml`としてコピーします。
3. `ALLOWED_ORIGIN`をGitHub Pagesの本番Originへ変更します。ワイルドカードは使用しません。
4. `traffic-volume-worker.js`をWorkerへデプロイします。
5. 発行されたWorker URLを`js/config.js`の`trafficVolumeWorkerUrl`へ設定します。

Worker URLとGitHub PagesのOriginが決まるまでは、実通信の完成確認はできません。

## 動作

- 熊本周辺BBOXを初期値にする
- `minX`、`minY`、`maxX`、`maxY`で範囲を上書きできる
- `roadType=3`を初期値にする
- `time`を省略した場合は約25分前の5分単位を使う
- 同一URLをCloudflare Cacheに5分保存する
- API失敗時は502とJSONエラーを返す
- 許可Origin以外は403を返す
- OPTIONSに応答する
