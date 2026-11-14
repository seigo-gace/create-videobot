# CreateVdobot｜ステッカー制作・管理・Stars販売 機能別マッピング

対象：TGtumbler配下の既存CreateVdobot。機能Issueを記録の検索入口として既存親Current・PRを維持する。

## 正本・機能Issue
- 親Current: https://github.com/seigo-gace/GateApp-Bot/issues/6
- 実装PR: https://github.com/seigo-gace/create-videobot/pull/1
- STK-01 素材変換と登録: https://github.com/seigo-gace/create-videobot/issues/2
- STK-02 マイパック/編集/復旧: https://github.com/seigo-gace/create-videobot/issues/3
- STK-03 Stars販売/同意/納品: https://github.com/seigo-gace/create-videobot/issues/4
- STK-04 Topic固定入口/DM公開: https://github.com/seigo-gace/create-videobot/issues/5
- 動画側再利用表: docs/TGTUMBLER_VIDEO_REUSE_MAP.md
- 動画側採用UI: docs/BOT_MENU.md
- ローカル設計v0.6は採用済み正本ではない。Masterの確定事項と提案/未実機検証を分ける。

## 機能ID → Source → 共通Owner → テスト → 実行確認
| ID |機能と確定要求|対象Source|共通依存・責務|検証範囲と未達|
|---|---|---|---|---|
| S01 | DM素材受信と入力削除 | src/telegram/stickerWizard.mjs | creatorBot.mjs、creatorScreenTransport.mjs、pgCreatorSessions.mjs | test/stickerWizard.test.mjs、実機未検証 |
| S02 | Telegram getFile取得 | src/telegram/telegramFileFetch.mjs | VideoBot既存媒体Adapter、上限20MB | download実機未検証 |
| S03 | 長辺512/100、縦横比保持 | src/stickers/geometry.mjs | mediaConverter.mjs | test/stickerGeometry.test.mjs |
| S04 | PNG、VP9、3秒、容量、透明余白 | src/stickers/mediaConverter.mjs | Gserver既存FFmpeg Docker | stickerRealFfmpeg.test.mjs、全形式Telegram登録未検証 |
| S05 | uploadStickerFile、create/add、getStickerSet | src/stickers/packRegistration.mjs | telegram/botApi.mjs | stickerPackRegistration.test.mjs、Telegram実登録未検証 |
| S06 | UNKNOWN再送防止/登録復旧 | stickerWizard.mjs、packRegistration.mjs、pgStickerInventory.mjs | 既存CAS session、Webhook | test/stickerWizard.test.mjs、test/sqlStickerSmoke.sql、src/runtime/creatorMigrateDockerSmoke.mjs。CI PostgreSQL 7 migrationあり、DB本番/再起動未検証 |
| S07 | パック一覧・本人追加 | stickerWizard.mjs、pgStickerInventory.mjs | 既存DM画面/VideoBot PostgreSQL | Sourceあり、実機未検証 |
| S08 | 素材置換・削除・並び順・絵文字・タイトル変更、パック全体削除、**本人パック最大10画像の直接タップ選択** | stickerWizard.mjs、stickerPackManagement.mjs、shopOwnerGallery.mjs、shopHttp.mjs、shopPreview.mjs、web/sticker-shop/app.js、creatorWiring.mjs、creatorPollingMain.mjs、pgStickerInventory.mjs | 本人CAS DM、Telegram set照合、所有者DB同期、画像を番号ボタンへ置換しない。既存Mini Appに画像グリッド（3列・最大10個/頁）を追加し、Tap→本人・パック・DB照合→同じDMの素材編集へ | Source・Node/HTTP回帰 CI [run #43571861955](https://github.com/seigo-gace/create-videobot/actions/runs/43571861955) SUCCESS、ソース HEAD f0216e9a。**本番Mini App URL公開・Telegram実機表示・タップ・Host反映は未検証** |
| S09 | 販売商品版・購入前承諾 | stickerSales.mjs、pgStickerSales.mjs、sql/008_sticker_sales.sql | 既存マイパックDM→素材版固定→条件・価格→同意 | Source/CI済、商用条件とGserver/実機未検証 |
| S10 | XTR invoice/precheckout/payment/納品再取得 | stickerSales.mjs、pgStickerSales.mjs、creatorBot.mjs、creatorWebhookAdmission.mjs、pgWebhookUpdates.mjs、botApi.mjs | 動画のpaidMediaから注文/charge台帳を分離、送信CASとバッチ納品 | Node227件、実DB購入・決済・再取得/重複抑止PASS（Actions 43171467208）。実Stars決済/ファイル保持は未検証 |
| S11 | 販売済み商品の編集・権利維持 | pgStickerSales.mjs、sql/008_sticker_sales.sql | 商品ID・素材file_id/unique_id固定、注文を商品版へ参照、通常パック編集は商品版不変 | Source/実PostgreSQL検証済。Bot媒体ID失効時の長期再取得保証・版改定UI/実機未検証 |
| S12 | Master指定Topic `-1002373696859` / **4640** に CreateVdobot本人が「🎨 投稿はこちら」を投稿・固定→本人DM | **CreateVdobot Owner**：`creatorTopicEntryPin.mjs`、`fileStickerEntryPin.mjs`、`creatorStickerPinMain.mjs`、`compose.videobot.topic-pin.yaml`。GateAppはTopic情報の提供のみ、GayBBSは投稿・pinしない | Sourceで固定送信先 `message_thread_id=4640`、DM `https://t.me/CreateVdobot?start=sticker`、送信結果不明の二重投稿防止、実Bot本人・管理者pin権限検証。従来のGayBBS `4291` は別Topicへの誤実装として採用しない | **Source修正済み／Node CI PASS**。CreateVdobotによる本番送信・pinはHost結果で要判定（未検証をPASS扱いしない）。 |
| S13 | 公開後DMエディター・投稿先ジャンプ・本人編集削除 | stickerSales.mjs、topicPublication.mjs、pgStickerTopicPosts.mjs、sql/009_sticker_topic_posts.sql | Verified GateApp Topic+Seller owner、実送信message_id保存、価格/商品版不変、購入済み権利保持 | Source/Node231件・実PG Topic smoke PASS。Host・Telegram送信/編集/削除/投稿先遷移の実機未検証 |
| S14 | 動画販売回帰維持（動画のみ手数料30%） | creatorWiring.mjs、pgStarsLedger.mjs | 既存動画販売のCurrent | 既存CIあり、Telegram実機回帰なし |
| S15 | 本番Git/Compose/DB/Webhook | deploy/Dockerfile、Gserver既存アプリOwner、GateApp-Bot live owner adapter | 共通ServerTerminal host.command。稼働Userbotは既存常駐IPCのみ、二重起動・logout厳禁 | Source CIのみPASS。Host f102 result not returned、最新HEADデプロイ/9 migrations本番/Telegram E2E/owner port接続はNOT_VERIFIED |
| S16 | 購入後に任意の相手へプレゼント | src/telegram/stickerSales.mjs、src/telegram/creatorBot.mjs、src/stickers/pgStickerGifts.mjs、sql/010_sticker_gifts.sql | 購入済み本人だけが一回限りの受取URL発行、Telegram共有先選択、最初の受取人へ固定、購入者権利維持、無償再取得。既存VideoBot画面/Session・sendStickerのみ再利用 | Source実装済、Node/実PostgreSQL gift receipt・二重受領・他人所有・再取得・Stars課金非増加テストPASS。Telegram実機/Gserver本番未検証。転送されたURLの受領者固定は最初の受取人方式で、宛先IDを事前取得する仕様ではない |

| S17 | Stars追加購入への公式外部導線（Telegram/@PremiumBot・Fragment） | `src/telegram/stickerSales.mjs`、`src/telegram/menuPanel.mjs` | CreateVdobotの既存DMメニューと購入画面にURLボタンのみ追加。外部Stars補充はTelegram/Fragment側の責務。XTR購入承諾・Invoice・販売30/70とは完全に分離し、BotはStars残高を補充したと主張しない。Fragment紹介料・独自手数料の契約は未確認で実装しない | `test/stickerSalesFlow.test.mjs`、`test/menuPanel.test.mjs` 追加。Source commit `c7e7a233`。CIとGserver反映・Android/iOS・Fragmentログイン/購入は別検証 |

## 担当・状態DBの分離
| 保存対象 | 既存Owner | 禁止事項 |
|---|---|---|
| DM状態・画面ID・revision | videobot_creator_sessions | 動画下書き消失、共通画面を増殖 |
| パック/ステッカー/登録受付 | videobot_sticker_packs、videobot_sticker_items、videobot_sticker_registration_receipts（sql/007_sticker_packs.sql） | UNKNOWNから無条件再送、Owner不一致の更新 |
| Stars注文/商品/納品 | VideoBot（動画と商品別責務） | 動画sendPaidMediaレシートをinvoice扱いに流用 |
| 購入後ギフトと受取者配送 | videobot_sticker_gifts、videobot_sticker_gift_delivery_items（sql/010_sticker_gifts.sql） | 購入済み注文・支払レシート改変なし、贈答リンクの平文DB保存なし、購入済み権利保持、一つの贈答リンクを複数人に付与しない |
| Topic/GATE/公開権限 | GateApp-Bot正規台帳・既存Owner | URL末尾4640をthread_idと断定 |
| 原素材 | getFile/private一時処理 | Public Repoに実データ・Tokenを記録 |

## 実戦操作→Bot内部処理の全マッピング
1. トピック固定ボタン→DM /start sticker→本人と起点確認→既存単一画面を編集。固定ボタンは未検証。
2. 種類・パック名（既存登録先なら省略）→既存CAS Sessionに本人の選択を保存。
3. 素材送信→getFile→一時保存→ffprobe→比率保持変換→ffprobeとサイズ/時間/形式検証→登録前確認。Sourceあり、Telegram実機未検証。
4. [登録]→operationをDB claim→uploadStickerFile→file_unique_idとphase永続保存→create/add→getStickerSet readback→pack/item確定→同一DMに登録結果と継続入力。Sourceあり、実機未検証。
5. タイムアウト→needs_reconcile記録、再送禁止→file_unique_idとset typeをgetStickerSetで照合、一致時のみ確定。失敗なら不明を維持。Sourceあり、本番再起動試験未検証。
6. マイパック→本人pack一覧→タイトル変更/素材一覧/順序/絵文字/削除確認/置換→編集前CAS保護→Telegram書込み→getStickerSet照合→DB台帳同期→元DM画面。結果不明なら再送せず確認のみ。Source/CI検証済み、Gserver・Telegram実機/パック全体削除は未達。
7. Stars販売→不変商品ID/価格/素材IDをDB保存→購入者へ公開パックの非独占・共有可能性/再取得制約を明示→本人同意→XTR invoice 1回→pre_checkout_query検証→successful_paymentから専用charge台帳へ冪等確定→最大3件ごとのBot DM配送・無償再取得。失敗したWebhookは同一fingerprintの決済通知に限りCAS安全再処理。/paysupport台帳Sourceあり。CI/PG PASS、実Stars決済・商用条件・実保管E2E未検証。
8. GateApp-Bot実TopicからVerified adapter取得（ボードvideo_chat・正確なTopic名・Chat/thread照合）→CreateVdobot本人の登録商品を1回送信→DBに実message_idと結果を永続化→本人DMのグループ・Topicタイトルとジャンプを表示→編集・削除→販売停止と購入済み版保持。GateApp側Topic固定入口はadmin確認後にCreateVdobot本人のBot APIで送信・pin、DB pin receiptで重複禁止。Source/CIはPASS、本番Adapter・Topic binding・pin・編集/削除のTelegram E2Eは未検証。

9. 購入済み商品→［🎁プレゼントする］→本人の有効な有料注文照合→192bit一回限りの贈答リンク作成（贈答台帳はSHA-256のみ保存、発行者の既存プライベートDMセッションに復旧用トークンを保持）→Telegram共有先選択→受取人が`/start gift_<token>`→受取人本人のDB権利を原子的に固定→本人宛DMへ素材バッチ配送→［受け取ったプレゼント］一覧から無償再取得。元の購入者・商品版・課金と台帳は変更しない。期限・贈答回数の追加制限は未決定のため勝手に設定しない。受取リンクは最初の受領者が確定し、第三者へ転送された場合の横取り防止までは保証しない。贈った側は［受取状況を確認］で受取済み表示へ切替え、受取済リンクは再共有ボタンから外す。Source/実DB CIを検証済み、Telegram共有・受取・再取得は実機未検証。

## 2026-11-12 Master最終指定：Bot所有／Topic ID訂正
- Master指定：グループID `-1002373696859`、**Topic ID `4640`**。`4291` への投稿・固定は誤った別Topicの操作であり、実際の指示Topicへの完成証明ではない。
- 投稿・ピン留め・DM入口の所有者は **CreateVdobot本人**。GayBBSは実行に関与させず、Gserverで必要なTopic情報を共有するだけ。既存CreateVdobot管理者権限とpin権限は本人Bot APIで実測確認済み。
- Source変更：自己Bot専用の一回限りの送信／pin、private token mount、durable receipt、Topic ID 4640。実Telegramでの送信/ピン留めは独立Host証拠まで未検証。

## 2026-11-12 STK-04 本番API設置の後続検証

- Master指定リンク `https://t.me/c/2373696859/4640` は既存メッセージ番号であり、Topic IDとの同一視をしない。今回のTelegram編集返却で `message_thread_id=4291` を独立に確認した。
- [Host Result #43281388142](https://github.com/G-ACE-inc/server-core/actions/runs/43281388142)：既存メッセージ `4652` を編集し、`chat_id=-1002373696859`、`message_thread_id=4291`、`is_topic_message=true`、インラインURL `https://t.me/CreateVdobot?start=sticker` と `pinChatMessage` ACK `true`。一時的なTopic検証失敗を理由に新規投稿を繰り返さず、Hostの重複防止receiptを `PINNED` とした。
- Telegram APIのピン留め応答はVERIFIED。実クライアントでの固定表示、ボタンタップ後のDM UI、現在のTopic登録行 `112` の名称/用途と本番Schema移行はNOT_VERIFIED。STK-04全体は受入未完了として区別する。

## 2026-11-12 STK-04 本番ボタン未設置の是正

- Master実機指摘：指定ステッカーTopicにBot DM移動ボタンがない。以前のCI成功は本番固定ボタン設置を意味しなかった。原因：GateApp-Botの固定処理はSourceに存在するが、稼働用に明示呼出し/所有者Providerがつながっていない（スタートアップ自動登録されていない）。CreateVdobotのグループ管理権限を要求していた点も責務不一致。
- 修正：GateApp-Botの管理者Botが実Topicへ送信・pinし、移動先CreateVdobotだけを独立getMeで本人確認。既存単一PostgreSQLのposting_sticker_entry_pinsに一件だけ記録し、結果不明時は再送しない。既存のGayBBS Dockerイメージへ一回限りのscripts/ensureStickerTopicPin.tsを同梱。グループBot/Userbotの二重起動・再ログインはしない。
- Host送信 req_20261112193200000000a104 / Actions 43207016741：START/Gateway ACCEPTED、Host結果返却 REQUEST_RESULT_NOT_FOUND（241秒）。実際の稼働checkout/登録Topic/権限/既存pin receiptは未読戻し。新規同等Host要求を盲目的に再送していない。
- 受入残：既存Gserverプロジェクト所有者が認可した正規経路で、実Bot両者の本人getMe、既存DBのverified Topic chat/thread、GroupBotのpin権限、Topicの実送信→pinTelegram応答→独立実機pin readback→ボタンからDMのステッカーメニュー到達を確認してはじめてPASSとする。運用Secret/Composeの無断追加・権限拡大は行わない。

## 実装・検証の記録契約
各機能Issueに (1)採用仕様と決定者 (2)Source path・commitとOwner (3)CI run (4)Host request/稼働 HEAD (5)Telegram本番 readback/受入 を分けて残す。UNKNOWNやNOT_VERIFIEDを成功へ書き換えない。
ソース変更は設計確認→実際の担当パスと依存を照合→変更→テスト→CI→Host→Telegramの順に実証。PRは実装の横断統合記録、Issueは機能別受入の入口。
動画・ステッカー／絵文字とも販売管理費30%・出品者分70%（2026-11-13 Master確定）。通常の返金申請UIなしと法令・Telegramの決済紛争対応は別。公開Telegramパックの購入者限定利用は保証しない。

## 本番反映におけるSource所有境界（2026-11-12実測）

- Gserver read-only request req_20261112064000000000c021: exit0。実行結果は公開メタデータだけで、実stdout回収は未完。
- Feature HEAD限定の安全照合 req_20261112070000000000c024: exit74（現在のcheckout branchがfeat/assistant-ai-and-sales-coreではない）。
- 既存feature worktree検索 req_20261112070500000000c025: exit72（該当branchの一意な既存worktreeを確認できない）。
- 現在checkoutを保護する切替可否 req_20261112071000000000c026: exit80（現branchはmain/masterではなく、別の変更を所有する可能性）。破壊的なgit switch/clone/worktree追加を行わない。
- Source CI: https://github.com/seigo-gace/create-videobot/actions/runs/43105210091 success。ただしGserver反映/TG登録/Stars購入/Topic pinのPASSではない。
- 本番完了には既存checkoutの正規所有者・反映先・稼働Compose/Secret/DB/Telegram実機を実測して、所有権を崩さない既存経路で反映する必要がある。現在のデプロイはNOT_VERIFIED。
