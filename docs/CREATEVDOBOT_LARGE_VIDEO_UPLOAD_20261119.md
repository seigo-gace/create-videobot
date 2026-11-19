# CreateVdobot大容量動画：公式Local Bot API受入マッピング（2026-11-19）

**Current:** [TGtumbler VIDEO #6](https://github.com/seigo-gace/GateApp-Bot/issues/6)
**Source PR:** [create-videobot #1](https://github.com/seigo-gace/create-videobot/pull/1)
**既存レイアウト、STK機能、Stars売上台帳、Userbotセッションを変更しない。**

## 仕様上の上限と方式
- [Telegram公式 Bot API server README](https://github.com/tdlib/telegram-bot-api#usage) の `--local` はダウンロードサイズ制限なし／アップロード **2,000MBまで**／サーバーにあるファイルの絶対パスを利用可能。サイズは2,000,000,000バイトとして安全側で検査する。
- 通常の公開 Bot API は大容量受信に20MBの `getFile` 限界があり、アップロードもサイズ上限がある。通常APIの上限を偽装・迂回しない。
- `file_id` はBot固有。Userbotの `file_id` を有料販売Botで使い回してはいけない。MTProto/Userbotを販売Botの非公式権限へ変えない。
- **2,000MBを超える動画の全件投稿は本経路の受入範囲外**。分割や別Botアップロードであたかも一つのStarsロックが付くと扱わない。別途の公式仕様と実機評価が必要。

## 既存実装と責務
1. Telegram `message.video` または MP4 `message.document` → `creatorWizard.mjs`（入力元ID・キャプション・本人状態管理）。
2. `telegramFileFetch.mjs`: `getFile` の `file_path` を使用。既存Local Bot API共有Root内の実ファイルなら安全な境界検証・readonly。公開Bot APIは従来のサイズ境界で停止。
3. `mediaProcessor.mjs`: `normalizeVideoDocument` の実動画検査。Local Bot APIの同一共有ファイルは `privateMediaUpload.mjs` でファイルパスを使った `sendVideo`、異なる一時パスはmultipartストリーム。両経路ともCreateVdobotの同一Botが受け取った `video.file_id` を返す。
4. `autoPreview.mjs`／`sampleMedia.mjs`: 元動画を保存・変更せず、実ffprobe→サムネ／最大30秒のサンプルを生成。FFmpeg一時ファイルはローカルパス共有外のためストリームアップロード。
5. `creatorScreenTransport.mjs`: 本人DMアルバムの画像・サンプル・動画を表示。本文内編集、既存CAS・公開前規約同意は維持。
6. `paidListingPublisher.mjs`: 同じBotの `file_id` を `sendPaidMedia` に渡す。無料サムネ/サンプルと有料本編、売上台帳・購入通知・返金は別責務。

## 本番稼働Gate（現時点 NOT_VERIFIED）
- Gserver内で単一Bot pollerに競合しない、既存のTelegram Local Bot API Serverを確認。無い場合のサーバー導入は独立の実稼働変更として正規権限とSecret管理で実施し、二重接続を避ける。
- Local API Serverには正式なTelegram `api_id`／`api_hash` が必要。Secretはチャット・GitHubへ貼らず、既存Host Secret経路を使う。
- Telegram公式READMEに従い、従来 `api.telegram.org` 側からの移行では対象Botの `logOut` と受信再開を順序立てて実行。複数Serverの同時受信は不可。既存の更新オフセット・処理中取引を保護する。
- `deploy/compose.videobot.local-media.yaml` は **既存の** `telegram-bot-api:8081` 名、外部共有ネットワーク、`/var/lib/telegram-bot-api` readonly rootを要求する。Host上の実証なくOverlayを自動有効化しない。
- 実際の1GB級サイズで、`getFile`→サムネ/サンプル→本人DMアルバム→投稿前同意→Stars本編Topic→購入解放/返金記録を検証。障害時に原ファイル・単一Poller・既存販売台帳を保護。
- 本番反映前後でimage SHA/Compose/config/DB migration 19件/Local API getMe/単一Pollerを独立読戻し。受入までは `USER_ACCEPTED=NO`。

## 検証済みのレベル（Source/CI）
- 23.2MBダミーMP4でmultipartストリーミング＋同一ローカルAPIファイルパス方式の単体テスト。
- Docker Node+FFmpeg実行イメージで1時間超のMP4からサムネと30秒以内サンプルを生成し、元MP4のハッシュ一致。
- ソース/CI成功はGserver実接続やTelegram本番送信の成功を意味しない。
