# Telegram Stars paid media event boundary

A `purchased_paid_media` notification is not itself a signed settlement or an authoritative per-seller earnings confirmation. The owner ledger must be reconciled with the trusted Telegram payment/Stars transaction evidence and refund paths; do not infer funds were settled from an update alone.

Webhook receiver must check `X-Telegram-Bot-Api-Secret-Token` against the configured secret *before* JSON parsing, keep dedupe by Telegram `update_id` and persist purchase evidence separately from confirmed charges. All event/charge IDs must be durable and atomic across restart. Source now includes `creatorWebhookAdmission.mjs`, `pgWebhookUpdates.mjs` + migration `006_webhook_updates.sql` for durable update-ID replay handling, `pgStarsLedger.mjs` for transaction reconciliation, and `creatorWiring.mjs` for dependency injection. None of these creates a public listener, deploys a Bot, authenticates a live host, or transfers Stars.

Avoid logging buyer IDs, media payloads, chat IDs, bot token, webhook secret and payouts. No real Telegram updates or financial records in the public GitHub repository.

## 2026-11-07 Source-only completion boundaries

- `creatorWiring.mjs` binds the existing VideoBot wizard, GATE/topic/peer review, persistent product/session/receipt/Stars stores, secure webhook, media processors and private Telegram screen adapter. It requires owner-supplied verified GATE, real PostgreSQL pool and private media-contract inputs; it cannot self-certify or invent a Topic. It does not change `src/runtime/main.mjs` and does not register a webhook.
- `creatorScreenTransport.mjs` implements the independent Bot's adapter for the verified common PR#11 DM contract (edit same screen; fallback only on confirmed Telegram edit rejection; unknown results never create an extra screen). Existing GATE's editor state remains in its owning project.
- `pgWebhookUpdates.mjs` plus `006_webhook_updates.sql` preserve a hashed input fingerprint + update_id, not raw chat/Star/user payloads. A completed update is harmless on Telegram resend. An unknown-response update is locked for evidence reconciliation, not blindly replayed.
- Existing 30% administration deduction terms are checked **before sending any paid or free media**, not merely before updating the listing status after sending. Invalid/unconfirmed seller terms have zero external publish side effects.
- Source CI proves tested mocked Telegram update flows and real isolated PostgreSQL schema/insert/compare-and-set checks, not a successful real payment or deployed runtime. Pending owner authority: exact video_sale Topic ID and verified GATE provider; Bot private token and storage; actual live service/DB migration and real media/Stars tests; creator recipient payout and fractional-Star settlement policy.
