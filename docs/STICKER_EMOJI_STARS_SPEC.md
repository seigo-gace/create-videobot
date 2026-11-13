# CreateVdobot｜ステッカー・絵文字制作／Stars素材販売（実装基準）

Status: IN_PROGRESS. Telegram Host/実機/販売E2Eは未検証。Source/CI合格を本番合格と見なさない。
Owner: TGtumbler → 既存 `seigo-gace/create-videobot`。既存PR #1上で変更。新しいBot/親Project/販売Ledgerを重複新設しない。
Master確定: 素材持込、静止/動くステッカーとカスタム絵文字、元比率維持、長辺512/100、既存DMエディターの画面差替え、専用TopicからCreateVdobotのDM、最小操作、Starsで素材商品販売、購入前の明示承諾、通常の自己都合返金UIなし。
既存動画販売（管理費30%/投稿者70%、サンプル/サムネ、投稿フロー）は変更禁止。ステッカー・カスタム絵文字の販売にも管理費30%／投稿者分70%を適用（Master 2026-11-13確定）。

## 1. Telegram公式の技術境界
- 画像はPNG/WebP静止ステッカー、GIF/MP4/WebM等の動的素材はWebM/VP9動画ステッカーへ変換。拡張子だけ変更しない。TGSベクター形式をラスタ動画から自動生成する機能は作らない。
- 通常ステッカーは**長辺が正確に512px**、他辺512px以下。カスタム絵文字は**100×100px**。元画像/フレームの長辺をそれぞれ512/100に比例縮小/拡大し、絵文字は100四方の透明キャンバス中央に配置する。元画像の縦横比変更・自動トリミング・背景切抜き禁止。
- 動画は最大3秒、最大30fps、VP9 WebM、音声なし、最大256KB。3秒超は先頭3秒採用を事前に案内し、最終プレビューを本人が確認。可能な透過は保持、既存の不透明背景を勝手に透明化しない。容量制限に収まらなければ明示的エラー。
- 出力変換はEXIF回転・動画display rotation・SAR/フレーム時刻を正規化した可視画像寸法で計算。形式・ffprobe・サイズ・デコード・元ファイルSHAとの別物性を確認してからアップロード。
- クラウドBot APIのgetFile通常制限20MBを超える元ファイルは、Local API Serverの正式導入・検証がない限り受付拒否。トークン・メディアはprivateで扱い、元バイナリを保護する。
- `InputSticker(sticker, format, emoji_list)`を作成。静止はstatic、動画はvideo。関連絵文字1～20個を必須とし、初期値1つを本人へ表示・変更可。packはownerの実user_id、getMeで検証したbot_username末尾`_by_<bot>`、最大64文字の一意短縮名、タイトル1～64文字、`sticker_type` regular/custom_emojiを区別。
- `uploadStickerFile`で実バイトをアップロード→`createNewStickerSet`または`addStickerToSet`→`getStickerSet`読戻しで種別/内容を照合。未知応答の場合の盲目的再送はしない。登録成功とPremium等の利用資格は別。

## 2. 責務と共通化
- メニュー／本人の下書き／既存DM差替え：`creatorBot.mjs`、`creatorWizard.mjs`、`creatorScreenTransport.mjs`、`pgCreatorSessions.mjs`の契約に従う。既存動画メニューを壊さず入口追加、並列入力所有者とRevisionを保護。
- 素材取得：既存`telegramFileFetch.mjs`のprivate・容量・token非露出・ダウンロード安全契約を参照。共通下位処理を再利用し、動画商品のメディア状態と混合しない。
- 画像幾何：`src/stickers/geometry.mjs`。画像と動画が一つの関数を使う。
- ステッカー登録属性：`src/stickers/packContract.mjs`。まだアップロード・API登録の完成ではない。
- GATE・Topic・投稿：`GateApp-Bot`の所有台帳・検証済みProvider経由。別の認証DB/ID決め打ち/MPB複製を作らない。
- 決済の共通性：`VideoBot`のWebhook検証・監査・冪等・会計原則を使用。ただし動画の`sendPaidMedia/purchased_paid_media`と素材商品の`sendInvoice/pre_checkout_query/successful_payment`は**異なる商品プロトコル**。動画専用スキーマ/会計料率を商品へ無断転用しない。

## 3. 最小UIの受入契約
**通常入口:** CreateVdobot DMに[ステッカー・絵文字]、専用Topicに[作成・公開・販売はこちら] URLボタンをピン留め→同じBot DM。
**同一DM画面:** [ステッカー][絵文字][両方] [マイパック][戻る]。素材を先に送っても選択済み目的を維持。初回だけ必要なパックタイトルを一度入力。2回目以降は既定パックへ自動誘導。
**素材送信:** ファイル受信→安全な変換→進捗を同じメッセージに更新→登録前の見た目・長さ・対象パック・絵文字をプレビュー→[登録する][絵文字変更][戻る]。
**連続登録:** 本人が明示ONにした場合のみ、同じ形式・パック・絵文字へ送信だけで登録。通常は最終[登録する]必須。投稿・販売は別途明示し、勝手にトピックへ流さない。
**完了:** 登録API成功とset読戻しを経て[パックを開く][続けて作成][マイパック][販売設定]。
**投稿後:** 専用Topic内の公開カードのmessage_idと商品版を台帳に記録。Bot DMの本人画面はグループ名/トピック名を示して[編集][削除]。内部IDをユーザー画面へ出さず再取得・検索・削除に保持。
- ボタンはInlineKeyboard、テキスト入力はTelegram標準DM送信欄、同一画面編集、入力メッセージ削除試行、戻るとキャンセル/古いボタンと二重押下を共通契約どおり処理する。

## 4. 元Topicの固定入口
- 指定: 「ビデオチャットの掲示板」→「ステッカーの公開と販売」 https://t.me/c/2373696859/4640 。**末尾4640はTopic IDと断定しない**。
- 既存Topic台帳からchat_id/thread_id/titleを照合。本人Botの管理権限を確認。既存固定導線があれば重複しない。
- `sendMessage`でURL InlineKeyboardを持つ単一入口を投稿、`pinChatMessage`、レシート保存・実message/固定状況読み戻し。Deep Linkの不透明tokenから元TopicをDBで復元、Botの/startは許容。
- ユーザーが公開確定した時点でのみ検証済みTopicへ投稿、TopicへジャンプするURLを提示。DM編集とTopic投稿の公開レシートを別に保護。

## 5. 有料商品／通常パックの決定的区別
- Telegramの通常セットには購入者ごとの排他的アクセス制御がなく、パックURL・素材の再共有も防げない。**通常のパックをDRM付き有料限定物と広告しない。**
- Starsで販売する対象は、納品できる**固定版の素材商品**。商品版ごとのhash/manifest/保管参照を購入後も保持し、セットを編集/削除しても購入済み版を破壊しない。素材ZIPや完成ファイルをprivately納品し、公開セットリンクは別扱い。
- 決済前の画面で商品名・納品内容・価格・商品版・再共有性・利用条件・自己都合返金なし（法令/Telegramの正当な例外除外）を表示。[同意して購入へ]の操作で条項版・本文hash・価格・本人・商品版・日時を永続記録し、**同意前にはInvoiceを出さない**。
- `sendInvoice(currency:'XTR')`→10秒以内の`answerPreCheckoutQuery`（本人・注文・同意・金額・版・納品可能性・通貨再照合）→`successful_payment`の`telegram_payment_charge_id`を唯一キーとして台帳確定→商品納品。失敗/unknownは再調停し、成功偽装・二重計上・盲目的二重送信をしない。
- 購入済み本人の再取得は再請求しない。商品版の再取得期間は商品規約として確定後に販売可能。
- **購入者向けの通常返金ボタン/申請フォーム/自動返金業務フローは実装しない。** 一方、`/paysupport`・法令上の正当異議・Telegramの強制取消/決済訂正記録は残す。存在しない返金権利を保証せず、存在する法定権利を消さない。
- 動画・ステッカーとも運営管理費30%/売り手70%は確定。ステッカーの売り手受取方法・精算端数・利用許諾・保存期間は**未確定**。第三者向け商用決済はその条件確定前に有効化しない。これらが未確定でも制作・登録・請求テストのSource開発は継続。

## 6. 実機E2Eで要求する受入
R01 横長/縦長/正方形/極端な比率: geometry + 実PNG + 100角透明padを実測
R02 GIF/MP4/WebM: VP9・30fps・3秒・256KB・音声なし・透過の画素検証
R03 素材20MB超・破損・回転・SAR・容量圧縮失敗のエラー/復帰
R04 static/video、regular/custom_emojiの実pack登録/追加/置換/削除/件数制限/readback
R05 初回名前/既定パック/連続登録/本人・権限/revision/再起動後編集
R06 同一DM画面の入力削除・前画面/取消・Android/iOS端末操作
R07 指定Topicの1件固定Deep Link・グループ/Topic表示・投稿後ジャンプ
R08 動画販売既存UI/商品/30%手数料/GATE/MPBの回帰PASS
R09 利用規約/商品固定版/明示同意保存、未同意・古い価格でprecheckout拒否
R10 本物のStars成功イベント・重複通知・決済timeoutの売上/納品整合
R11 買った商品の無料再取得、販売停止/セット編集後も買った商品版を保持
R12 任意返金導線なし、paysupport/外部訂正は記録・正当対応可能
R13 失敗リトライ/二重押下/未知API結果/変換ワーカー停止/再起動の復旧
R14 Source/CI/Host/Telegram実機/USER受入を独立区別し、未実行をPASSと報告しない

Sources: https://core.telegram.org/stickers · https://core.telegram.org/bots/api · https://core.telegram.org/bots/payments-stars
