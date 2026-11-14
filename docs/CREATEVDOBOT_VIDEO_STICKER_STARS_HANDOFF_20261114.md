# CreateVdobot｜次チャット引継ぎ：VIDEO／ステッカー共通基盤／Stars全系統（2026-11-14 JST）

> **引継ぎ資料であり、採用仕様の上書きや全機能完成の宣言ではない。** 次チャットはGitHub Project Current・正本・Source HEAD・実HostをFresh確認する。推測の実装、旧Snapshotに基づく編集、実機未検証の完成報告は禁止。

## 1. 目的と正本
- TGtumbler配下の既存 **CreateVdobot** を引き続き使用。動画Stars販売・売上/出金申請、ステッカー/絵文字の作成・管理・Stars販売を、同BotのDM UI・同一Gserver稼働で継続。**新Bot・新Repo・動画のための新たな金銭DBの複製をしない。**
- VIDEO親Current: https://github.com/seigo-gace/GateApp-Bot/issues/6
- STK-01〜04: https://github.com/seigo-gace/create-videobot/issues/2 、/3 、/4 、/5
- 現行実装: PR #1 https://github.com/seigo-gace/create-videobot/pull/1 、branch `feat/assistant-ai-and-sales-core`、本記録時HEAD `25e003fb431abce5a777e964f04c1bd8567e9a70`（**作成前のHEAD**。この引継ぎファイル追加commit以降は必ずFresh取得）。
- 併存する別作業: 公開動画収集・無料約60秒サンプル／Stars月額サブスクは **別PR #6** https://github.com/seigo-gace/create-videobot/pull/6 、branch `chat/userbot-public-video-collect-20261114` 。PR #1へ暗黙mergeしない。
- 採用設計／共通契約: `docs/STICKER_FUNCTION_MAPPING.md`、`docs/TGTUMBLER_VIDEO_REUSE_MAP.md`、`docs/STICKER_EMOJI_STARS_SPEC.md`、動画UI `docs/BOT_MENU.md`、GateApp-Bot現行共通UI契約。**これらの古い「本番未反映」「画像タップMini App」記述は2026-11-14後続実装と矛盾する可能性がある。最新のMaster指示・Source/Runtime・Currentを優先して照合。**
- TGtumblerの対外ドメインは **hentaigay.org**。他Zoneの無断利用、新規Ingress作成、既存Tumblr/販売導線の破壊は禁止。

## 2. 共通で再利用する責務（VIDEO／STK両方）
| 責務 | 実装Owner | 継承すべき意味 |
|---|---|---|
| Private DM 画面更新／InlineKeyboard／入力削除 | `src/telegram/creatorScreenTransport.mjs`, `creatorBot.mjs`, `creatorWizard.mjs`, `stickerWizard.mjs` | Bot内UI、原則1画面、旧画面差替え・戻る・キャンセル・本人編集、コマンドメニュー乱立をしない |
| 受付session／画面ID／CAS revision | `src/sales/pgCreatorSessions.mjs`、`videobot_creator_sessions` | 同じBot DMでVIDEOのdraftとSTK pendingが競合・消去しない。入力更新の本人限定／古いcallback拒否 |
| Telegram API・Webhook／poll更新の冪等 | `src/telegram/botApi.mjs`、`creatorWebhookAdmission.mjs`、`src/sales/pgWebhookUpdates.mjs`、`creatorBot.mjs`、`src/runtime/creatorPollingConsumer.mjs` | 受付更新の重複処理防止。**支払イベントは種別別に所有ルーティング** |
| 本番起動・DB接続・回収 | `src/runtime/creatorPollingMain.mjs`, `creatorWiring.mjs`, `creatorMigrate.mjs` | Gserverの既存単一 `gace-createvdobot-videobot-poll-1`、別pollerを起動しない |
| 媒体取込・処理 | `src/telegram/telegramFileFetch.mjs`、VIDEO `src/sales/{sampleMedia,autoPreview}.mjs`、STK `src/stickers/{geometry,mediaConverter}.mjs` | getFile/一時取得は共通責務。VIDEOサンプルとSTKの画像・VP9変換は異なる要件で分離 |
| Topic/GATE/投稿先 | GateApp-Botの正式提供元Topic/GATE adapter、必要時既存MPB | URL末尾からthread IDを推定しない。販売Bot自身が投稿する範囲とGateApp Botの責務を混在させない |

**接続順:** Sourceの各モジュール実体→既存GATE/Topic契約→実PostgreSQL→Gserver Runtime→Telegram実機→受入。書き換え禁止範囲は維持し、できているVIDEOをSTKの修正で破壊しない。

## 3. Starsの全系統（**金銭イベント台帳は分離**）
| 系統 | Bot/API | Source/台帳 | 仕様と状態 |
|---|---|---|---|
| VIDEO本編の単品売り | Telegram公式 `sendPaidMedia`、購入 `purchased_paid_media` | `src/telegram/{creatorWizard,creatorWiring,creatorUi}.mjs`、`src/sales/{pgStarsLedger,telegramPurchase,managementFee}.mjs`、VIDEO posting receipts/listings | サムネ1・無料サンプル30秒1・Stars有料本編は別メッセージ。サンプル30秒超は先頭30秒に自動切出し。価格50/100/300/500/1000/自由指定。マイ動画10件/頁。実Stars購入／解放／返金／売上・出金は未総合E2E。 |
| STKパックの商品販売 | `sendInvoice` XTR → `pre_checkout_query` → `successful_payment` | `src/telegram/stickerSales.mjs`、`src/stickers/pgStickerSales.mjs`、`sql/008_sticker_sales.sql` | 購入前の商品明示と同意、snapshot固定・購入charge/納品を冪等に管理。Telegram公開packを購入者限定にできるとは誤説明しない。実Stars実課金・実機配送/再取得は未受入。 |
| STKプレゼント | 課金済み商品版の受贈リンク、通常DMで納品 | `src/stickers/pgStickerGifts.mjs`、`stickerSales.mjs`、`sql/010_sticker_gifts.sql` | 購入者の権利保持、一回限りリンク、受取人固定、追加請求なし。Bot実機受贈未確認。 |
| STK関連のPaidPhoto | `sendPaidMedia` / `purchased_paid_media`（パックinvoiceとは別の購入イベント） | `src/telegram/stickerPaidPhotoFlow.mjs`、`src/stickers/pgStickerPaidPhoto.mjs` | 追加の課金系統であり、ステッカー商品invoiceやVIDEO本編購入として誤ルーティングしない。現行の公開/実課金/受渡は別E2E。 |
| 月額Stars加入と動画配信 | Telegram公式サブスク招待リンク、動画配信 | **別PR #6** `src/collection/subscriptionInvite.mjs`, `subscriptionPublisher.mjs`, `pgSubscriptionPublications.mjs` | 非公開サブスクchannel実測 `-1004396338340` は過去getChat/getChatMemberでBot管理者・invite権限を確認。月額価格、正式招待リンク実発行、無料サンプルTopic実thread、Stars加入/更新/投稿E2E未完。**PR #1の単品VIDEO/STKとは別ルート。** |
| Starsの追加購入導線 | `https://t.me/PremiumBot`、`https://fragment.com/stars` への外部リンク | `src/telegram/{stickerSales,menuPanel}.mjs` | Botは残高補充を実行・保証しない。紹介報酬/独自手数料を仮定しない。UI実機確認・残高増加は未検証。 |
| 収益/管理費/出金申請 | Bot残高と出品者ごとの内部売上を分離 | `src/sales/{managementFee,pgStarsLedger}.mjs`、`src/telegram/{creatorWizard,creatorUi}.mjs` | **VIDEO管理費30%、投稿者計算上70%** がMaster確定。実Stars残高から第三者へ自由に送金可能とは確認していない。精算・引出を成功済みと表示しない。 |

**重要な仕様差異:** `src/sales/managementFee.mjs` には現行 `STICKER_MANAGEMENT_FEE_POLICY_ID='sticker-admin-30-20261113'`、`src/stickers/pgStickerSales.mjs`にもSTKの30/70計算が存在する。一方、初期STK-03 Current/旧Mappingには『動画30%を勝手にSTKへ適用しない』とある。**後続のMaster決定記録と当該実装採用の照合が必須**。無断でSTKの手数料を削除/変更するな。VIDEOとSTKの領収台帳は分離する。

**出金の未解決:** 動画の投稿者へ実際のStarsを直接払うAPI・実受取条件、申請額の端数、運営が代行換金しない最終設計は実装と公式可否を再検証。会計上の70/30と実払出を混同しない。既存VIDEO方針に逆らう「運営による換金・現金化代行」を復活させない。

## 4. ステッカー関連の11/14修正（次チャットでVIDEOへ再利用可能）
- **編集UIの採用形:** Telegram Mini App / Web Appによる管理はMasterが差戻し。Bot DMで1ページ最大10件、素材選択ボタンは横4/4/2、前へ/次➔。画像そのものから任意Bot callbackは取れない。過去のWebApp本番HTTPS PASSは採用UIのPASSではない。既存ショップ/販売用Web URLは依存関係があるので無断停止しない。
- **登録結果の回収:** `stickerWizard.mjs` → `creatorWiring.mjs` の `reconcileStickerRegistration` → Telegram `getStickerSet`。登録済なら完了表示。登録前に失敗とDBが確証できる場合だけ解除。送信済み可能性ありなら二重create/add禁止。
- **定期回収:** `creatorPollingMain.mjs:sweepStickerRegistrations` が既存単一poller内で非同期走査。`pgCreatorSessions.mjs:listPendingStickerRegistrations` は未確定状態と試行時刻を読取。**自動照合5回、30秒以上の間隔、回数はDB永続化**。5回でも未確定なら自動試行を打切り、その場合だけ **［🔄 手動で登録状態を回収］** をDMに表示。手動もreadbackのみ。再起動後も試行回数を継続。関連SRC HEAD `25e003fb431abce5a777e964f04c1bd8567e9a70`。
- **証拠:** CI https://github.com/seigo-gace/create-videobot/actions/runs/43623489289 SUCCESS。本番反映 Host https://github.com/G-ACE-inc/server-core/issues/351#issuecomment-6881798112 PASS/exit0。実DB照会 https://github.com/G-ACE-inc/server-core/issues/351#issuecomment-6881811529 PASS/exit0。先行4 module自動回収本番反映 https://github.com/G-ACE-inc/server-core/issues/351#issuecomment-6880244013 PASS。**Telegram通信を強制遮断→自動5回→手動ボタン→本当の回復のE2EはNOT_VERIFIED**。
- **未満足注意:** 実際の10個の画像サムネがBot UIに表示されているとは実証していない（絵文字+番号のBotボタンを横配列）。素材の実画像表示要求と、文字/絵文字ボタン実装を混同せず、先行仕様の中抜きをしない。

## 5. 次のVIDEOチャットで最初に行う作業
1. Manifest → GPT CHAT #17 → LOAD_SCOPE → Work Routine §6 → VIDEO親Current #6／STK-01〜04／Source HEAD／PR #1・#6（別branch）をFresh復元。
2. **VIDEO共通機能再監査:** `creatorBot`のイベント入口、単一DM画面、session CAS、VIDEO media 30秒サンプル+本編の区別、2段階投稿のreceipt、Telegram Unknown時の安全なreadback/限定自動回収、必要時最終ボタン。STKの5回/30秒をVIDEOの支払イベントへ**そのままコピーしない**。同じ回復原則を責務別に適用する。
3. **Stars全系統E2E:** VIDEO `sendPaidMedia` 購入/解放/台帳/返金/管理費/出金UI、STK invoice/precheckout/payment/配送/再取得、ギフト、PaidPhoto、Stars追加購入導線、別PR #6月額加入を分離してテスト。実課金の有無、テストDC証拠、BOT残高と出品者内部売上を区別。
4. **Topic/GATE/MPB:** 入口の固定ボタン、正規Topic ID、DM→元のグループ名/Topic名、商品公開後編集/削除/ジャンプ。既存GayBBS/MPBが管理する権限と販売Bot自身の送信・領収を混ぜない。
5. 最新CI→許可済みGserver Host→稼働SHA/DB/単一pollerのreadback→必要時常駐Userbotの既存allowlisted IPCのみで実機E2E。Userbotをログアウト/別プロセスでセッションopenしない。
6. **証拠を残す:** GitHubの該当Currentに重要checkpoint、Notion既存議事録にMaster決定/差分とEvidenceリンク（繰返しの1コマンド毎ではなく意味のある節目に追記）。PASSはSource、CI、Host、Telegram実機、USER_ACCEPTEDに分ける。

## 6. 受入未達（明示）
- VIDEOの実Stars購入→paid media解除→実売上台帳→返金と出金申請／実受取を含むE2E。
- STKの実Stars XTR購入、決済失敗/通信断、納品・無償再取得、受贈、素材10件画像表示のユーザー受入、登録途中切断復旧テスト。
- STK手数料30/70の後続採用記録照合、金銭系統のcross-routing負荷・冪等/所有権テスト。
- 月額サブスクの価格・公式リンク・本編/サンプル投稿・加入更新E2E。
- PR #1の変更、PR #6の変更が各自の正本に対して全機能完成と証明された状態にはない。

**引継ぎキーワード:** 「#開発モードで CreateVdobot VIDEO／STK共通基盤・Stars全系統を継続。docs/CREATEVDOBOT_VIDEO_STICKER_STARS_HANDOFF_20261114.md と親Current GateApp-Bot#6、STK-01〜04をFresh確認し、VIDEOから再利用できる責務をマッピング・実装・検証せよ。STK復旧5回/30秒/最終手動を保持し、VIDEO/商品/決済台帳は混在させず、Source/CI/Host/Telegram E2Eを分けて本番まで進めろ。」 
