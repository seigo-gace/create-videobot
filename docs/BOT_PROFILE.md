# 既存Telegram Botのプロフィール設定（開発中）

- **対象既存Botは `@CreateVdobot` と確定（2026-11-04 JST実機結果）。既存Botのusernameは変更しない**。Telegram公式仕様上、usernameはBot作成後に変更できない。既存Botを動画販売用途に転用する場合は、対象の既存Bot usernameを実機で確認してから実行する。
- 他ProjectのBotとTokenを混同しない。@gaceincbot はG-ACE系として既知だが、動画販売Botだと確認されていないため、無断で設定変更しない。
- `src/telegram/profileSetup.mjs` は現状照会（既定）→差分設定（confirmChange=true）→readbackを実装。日本語の表示名・長文説明・短文説明・/start・/helpを設定対象にする。未実装の販売機能を稼働済みとは表現しない。
- 変更前に対象Tokenが示す `getMe().username` と指定した `expectedUsername` を照合する。不一致は書込禁止。
- 本番Tokenを公開リポジトリ・チャット・CIログに置かない。2026-11-04 JST確認（Master提供のWSL実機出力）：対象 `@CreateVdobot` の `getMe` 本人確認後、`/home/gace/.config/create-videobot/telegram_bot_token` へ0600でToken保存済。プロフィール4項目（name・description・short_description・commands）は `UPDATED=name,description,short_description,commands`、`READBACK=PASS`、`VERIFY=PASS`、`EXIT_CODE=0` を確認。Token実値は未取得・未記録。GitHubでのBot稼働・Gserver接続・支払処理稼働は未検証。
- 重要: APIに設定できるコマンドが、まだ動作することを意味しない。Bot本体の処理は別に実装・検証する。
