# Telegram Stars paid media event boundary

A `purchased_paid_media` notification is not itself a signed settlement or an authoritative per-seller earnings confirmation. The owner ledger must be reconciled with the trusted Telegram payment/Stars transaction evidence and refund paths; do not infer funds were settled from an update alone.

Webhook receiver must check `X-Telegram-Bot-Api-Secret-Token` against the configured secret *before* JSON parsing, keep dedupe by Telegram `update_id` and persist purchase evidence separately from confirmed charges. All event/charge IDs must be durable and atomic across restart. These files implement **parsers and admission helpers only**; they do not create a public endpoint, authenticate against Telegram payment infrastructure, or transfer Stars.

Avoid logging buyer IDs, media payloads, chat IDs, bot token, webhook secret and payouts. No real Telegram updates or financial records in the public GitHub repository.
