# TGtumbler VIDEO｜再利用マッピング（2026-11-07 / Source確認）
## Ownerと現在の変更境界
- Parent TGtumbler。動画販売 Owner `seigo-gace/create-videobot` 既存 Draft [PR #1](https://github.com/seigo-gace/create-videobot/pull/1)。本番起動・デプロイ・実Stars/第三者向け販売なし。
- 3掲示板の投稿・GATEは既存 [GateApp-Bot PR #11](https://github.com/seigo-gace/GateApp-Bot/pull/11)、既存MPBは`seigo-gace/-AdminSystem/server/modules/multipost/`。参照のみ。提供元の無断変更なし。
- 先に[GATE共通UI契約](https://github.com/seigo-gace/GateApp-Bot/blob/chat/tgtumbler-profile-a05-20261104/docs/TGTUMBLER_COMMON_UI_CONTRACT.md)と[機能マッピングCurrent #7](https://github.com/seigo-gace/GateApp-Bot/issues/7)を照合し、販売者情報を既存GATE管理者セッションへ保存しない。

## 実装・責務・接続状況
| 機能 | 既存Owner / Source | 確認した事実・再利用 |
|---|---|---|
| DM同一画面編集、前画面差替え・入力削除 | GateApp-Bot PR#11 `services/dmWizardScreen.ts` | `showWizardScreen`、`removeUserWizardInput` 実装あり。販売Botは独立Bot Tokenなので画面契約をAdapter越しに継承。別の画面掃除ロジックを再発明しない |
| DM入力所有権 | GateApp-Bot PR#11 `services/dmInputOwner.ts` | Profile/Room/Announcement等のDM同時入力衝突を判別。VideoBotのPrivate DMは別Bot/別Session owner。GATE管理者Sessionを流用せず連携契約のみ |
| 投稿下書き・revision・screenMessageId | GateApp-Bot PR#11 `services/publicPostRepository.ts` | 既存SQL/再開/古いRevision拒否実装を参照。新規Profile/Room DBや共通ウィザード作り直しは禁止。VideoBot固有の販売下書き状態だけ独立Ownerとして保持 |
| Verified Topic/公開Feature Gate | GateApp-Bot PR#11 `services/topicRouting.ts`、`postingDelivery.ts`、`publishService.ts` | Topic ID・title・verifier・公開ゲート/POST delivery claimの既存実装あり。ただし現行PostPurposeは profile/room/announcement/link のみ。**動画販売目的を未検証の数値や別用途Topicに読み替えない**。GATE提供元から検証済み動画販売Topicと公開可否を受け取る契約が必要 |
| MPB共通配送 | -AdminSystem `server/modules/multipost/{core,dispatcher,store,renderer,scheduler}.ts` | リクエスト冪等→永続化→表示→配送→messageバインド→監査が既存実装。現在のDispatcherは sendMessage/editMessage/deleteMessage/sendPoll のみ、**sendMediaGroup/sendPaidMediaは実装範囲外**。既存MPBを複製せず、VideoBotの2段メディア送信で同じ安全性・受領原則を満たす |
| 有料Stars本編 | create-videobot `telegram/paidMedia.mjs`、`publishPolicy.mjs`、`botApi.mjs` | sendPaidMediaパラメータとGATE承認注入の基礎コードが既にある。新実装と重複させず接続 |
| Stars購入・返金台帳 | create-videobot `sales/telegramPurchase.mjs`、`sales/ledger.mjs`、`telegram/webhookAdmission.mjs` | 購入通知parser、外部検証フラグと冪等会計純関数/秘密ヘッダ検証は既存。永続化・本物のStars取引照合と払い出しは未接続 |
| サムネ・サンプル | create-videobot `sales/{sampleMedia,autoPreview}.mjs`、`telegram/freeAlbum.mjs` | 30秒自動切出し/不足分自動生成、Spoiler2件の無料アルバム+独立PaidMediaパラメータ。Bot getFile→転送/再uploadは未接続 |
| クリエイターUI | create-videobot `telegram/{menuPanel,creatorUi}.mjs` | ボタンレイアウト/新規編集データモデル/Stars入力/マイ動画10件データ生成。現実Updateと永続Sessionの配線は未接続 |

## 変更禁止/誤完成防止
- `GateApp-Bot/master`だけを見て共通UIや投稿/プロフィール機能「未実装」と断定しない。PR #11のHead / Sourceを確認する。
- MPBの汎用`sendMessage`をStars有料メディア配送に偽装しない。通常アルバムと有料本編は異なるTelegramメッセージ。両message_idを版/商品IDに関連づけて永続化し、未知結果は再送停止・照合。
- 公開済み本編の価格/内容/権利を通常投稿の編集APIで置換できるとは断定しない。元決済証跡を保持。
- Bot API token、利用者ID、実動画、売上実データをPublic Repo/CIへ入れない。新しい提供元/Host変更、外部AI起動なし。
- 現在のSource CI=Mock/オフラインテスト。Telegram/Gserver/Stars実機受入は**未検証**。

## 次の接続（今回の開発CU）
1. VideoBot内の画面・購入・配送を**既存Ownerを再利用する境界契約**に結合し、独立の金銭台帳/媒体参照のみ扱う。
2. Topic/GATE/Feature Gateは既存提供元の正規読み取り契約から取得する。未接続なら実投稿を拒否。Bot独自の認証・Topic IDを偽造しない。
3. 上記 Sourceの Unit/契約・隔離統合CI → 承認済みHost/実Telegram/Starsの順に検証。Production/paidに対する自動GOなし。

## 2026-11-07 Source接続実績と完成判定（追記）
- 実装した再利用接続：`src/telegram/paidListingPublisher.mjs` は既存 `paidMedia.mjs` と `freeAlbum.mjs` を、承認済みTopic/GATE/Feature Gate・専用永続レシートを注入して2メッセージとして送信する。通信結果不明時は `needs_reconcile` に固定し二重送信禁止。既存MPBを移植/複製しない。
- `src/telegram/creatorBot.mjs` → `creatorWizard.mjs` は、PR#11のDM同一画面・入力削除・revisionの**インターフェイス契約**に従い、Private Botの別セッションから既存メニューと新規/編集を接続。`pgCreatorSessions.mjs` /`sql/002_creator_sessions.sql` が販売Bot内の永続CAS。GATE管理者セッションや公開済み掲示板の下書きを流用しない。
- `src/sales/pgListings.mjs` と `sql/003_video_listings.sql` は商品・売り手・media file_idの私有保存、編集CAS、公開済み動画/価格の直接上書き拒否。公開成功は無料2件＋有料本編1件の実証済みmessage_idでのみ確定。
- `src/sales/pgPostingReceipts.mjs`/`sql/001_video_post_receipts.sql` は二重投稿防止とTelegram部分失敗を保護する専用レシート。
- `src/telegram/telegramFileFetch.mjs` は公式getFileの通常20MB制限内で受信し、`mediaProcessor.mjs`が既存`sampleMedia.mjs`と`autoPreview.mjs`を呼び出す。`privateMediaUpload.mjs` は**既存の実在し検証済みプライベート保管先が注入された場合のみ**アップロード。未承認先を勝手に生成しない。
- プレビューの各動画の権利・出演者全員の成人/同意確認を`creatorUi.mjs`で維持し、本編差し替えで同意を失効。本人の明示［投稿する］＋承認済み外部公開Providerがある場合に限り動画販売を行えるよう`creatorWizard.mjs`を拡張。Provider不在・実Topic不明時は拒否し、運用上の合格を偽装しない。

**Source CI根拠**：PR#1 branch Head `f1c92cc30b33042c11f5a0a8d068d67156b462db`、[GitHub Actions #42364415488](https://github.com/seigo-gace/create-videobot/actions/runs/42364415488)、Node.js Unit 95/95 PASS（0 FAIL/0 SKIP）。所有者の実Topic登録・実PG migration/Telegramメディア取得・プレビュー生成/保管先・Stars購買実照合・Bot→第三者Stars払出は**未検証／接続なし**。このCI結果は本番完成、サービス起動、公開許可の証拠ではない。

**外部制約と保護判定**：Telegram Bot所有者のStars収益引き出しと、Bot残高から複数クリエーターへStarsを直接移転するAPIは別。後者の公式対応が未立証で、実第三者販売・引き出しを有効化できない。発行者の権利/適用規約・検証済み動画販売Topic・接続先非公開メディア保管・実Tokenは、個別の運用事実を検証するまでSourceのFake/Boolean値を「本番PASS」にできない。Bot起動/デプロイ/実決済は2026-11-04の既決境界を変更しない。
