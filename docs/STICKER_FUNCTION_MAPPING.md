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
| S08 | 素材置換・削除・並び順・絵文字・タイトル変更、パック全体削除 | stickerWizard.mjs、stickerPackManagement.mjs、creatorWiring.mjs、pgStickerInventory.mjs、botApi.mjs | 本人CAS DM、Telegram set照合、所有者DB同期、購入済み版保護 | Source CI 221/221＋実FFmpeg 2/2＋PostgreSQL同期 PASS（run 43167733069）。全パック削除・購入権利との整合、Gserver/Telegram実機は未達 |
| S09 | 販売商品版・購入前承諾 | 現行Source未確認 | VideoBot商品台帳、動画決済とは分離 | 未実装/未検証 |
| S10 | XTR invoice/precheckout/payment/納品再取得 | botApi.mjsは一部allowlistのみ | 共通Webhook、商品専用レシート | 未実装/未検証 |
| S11 | 販売済み商品の編集・権利維持 | 現行Source未確認 | 購入版固定と素材保管の分離 | 未実装/未検証 |
| S12 | 指定Topicピン留め→Bot DM | stickerWizard.mjs、creatorBot.mjsにDeep Link入口 | GateApp-Bot Topic台帳/所有者 | Topic実機設置・readbackなし |
| S13 | 投稿後DMエディター・投稿先ジャンプ・本人編集削除 | Source未確認 | GateApp-Bot Topic/投稿Owner | 未実装/未検証 |
| S14 | 動画販売回帰維持（動画のみ手数料30%） | creatorWiring.mjs、pgStarsLedger.mjs | 既存動画販売のCurrent | 既存CIあり、Telegram実機回帰なし |
| S15 | 本番Git/Compose/DB/Webhook | deploy/Dockerfile、Gserver既存アプリOwner | 共通ServerTerminal host.command | Host/Token/Telegram E2E未完了 |

## 担当・状態DBの分離
| 保存対象 | 既存Owner | 禁止事項 |
|---|---|---|
| DM状態・画面ID・revision | videobot_creator_sessions | 動画下書き消失、共通画面を増殖 |
| パック/ステッカー/登録受付 | videobot_sticker_packs、videobot_sticker_items、videobot_sticker_registration_receipts（sql/007_sticker_packs.sql） | UNKNOWNから無条件再送、Owner不一致の更新 |
| Stars注文/商品/納品 | VideoBot（動画と商品別責務） | 動画sendPaidMediaレシートをinvoice扱いに流用 |
| Topic/GATE/公開権限 | GateApp-Bot正規台帳・既存Owner | URL末尾4640をthread_idと断定 |
| 原素材 | getFile/private一時処理 | Public Repoに実データ・Tokenを記録 |

## 実戦操作→Bot内部処理の全マッピング
1. トピック固定ボタン→DM /start sticker→本人と起点確認→既存単一画面を編集。固定ボタンは未検証。
2. 種類・パック名（既存登録先なら省略）→既存CAS Sessionに本人の選択を保存。
3. 素材送信→getFile→一時保存→ffprobe→比率保持変換→ffprobeとサイズ/時間/形式検証→登録前確認。Sourceあり、Telegram実機未検証。
4. [登録]→operationをDB claim→uploadStickerFile→file_unique_idとphase永続保存→create/add→getStickerSet readback→pack/item確定→同一DMに登録結果と継続入力。Sourceあり、実機未検証。
5. タイムアウト→needs_reconcile記録、再送禁止→file_unique_idとset typeをgetStickerSetで照合、一致時のみ確定。失敗なら不明を維持。Sourceあり、本番再起動試験未検証。
6. マイパック→本人pack一覧→タイトル変更/素材一覧/順序/絵文字/削除確認/置換→編集前CAS保護→Telegram書込み→getStickerSet照合→DB台帳同期→元DM画面。結果不明なら再送せず確認のみ。Source/CI検証済み、Gserver・Telegram実機/パック全体削除は未達。
7. Stars販売→商品版と再共有条件表示→購入者明示同意→XTR invoice→pre_checkout_query→successful_payment→商品配送→無償再取得。未実装/実決済未検証。
8. 公開Topicへ一回投稿→実message_id保存→本人DMエディターへ切替→編集/削除とTopicジャンプ。未実装/実機未検証。

## 実装・検証の記録契約
各機能Issueに (1)採用仕様と決定者 (2)Source path・commitとOwner (3)CI run (4)Host request/稼働 HEAD (5)Telegram本番 readback/受入 を分けて残す。UNKNOWNやNOT_VERIFIEDを成功へ書き換えない。
ソース変更は設計確認→実際の担当パスと依存を照合→変更→テスト→CI→Host→Telegramの順に実証。PRは実装の横断統合記録、Issueは機能別受入の入口。
動画管理費30%は動画のみ確定。通常の返金申請UIなしと法令・Telegramの決済紛争対応は別。公開Telegramパックの購入者限定利用は保証しない。

## 本番反映におけるSource所有境界（2026-11-12実測）

- Gserver read-only request req_20261112064000000000c021: exit0。実行結果は公開メタデータだけで、実stdout回収は未完。
- Feature HEAD限定の安全照合 req_20261112070000000000c024: exit74（現在のcheckout branchがfeat/assistant-ai-and-sales-coreではない）。
- 既存feature worktree検索 req_20261112070500000000c025: exit72（該当branchの一意な既存worktreeを確認できない）。
- 現在checkoutを保護する切替可否 req_20261112071000000000c026: exit80（現branchはmain/masterではなく、別の変更を所有する可能性）。破壊的なgit switch/clone/worktree追加を行わない。
- Source CI: https://github.com/seigo-gace/create-videobot/actions/runs/43105210091 success。ただしGserver反映/TG登録/Stars購入/Topic pinのPASSではない。
- 本番完了には既存checkoutの正規所有者・反映先・稼働Compose/Secret/DB/Telegram実機を実測して、所有権を崩さない既存経路で反映する必要がある。現在のデプロイはNOT_VERIFIED。
