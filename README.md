# create-videobot

Telegram Stars paid-video sales bot with independently bounded Assistant AI integration.

> Pre-Gserver staging only. No production integration, credentials, personal records, payment keys or real transactions.

## Ownership
- VideoBot owns paid-media listings, purchase-event reconciliation and creator sales ledger.
- GroupBot/GATE owns group membership verification. Tumblr orchestration owns campaigns.
- Assistant AI is optional; its provider adapters may be configured via `ASSISTANT_AI_GROQ_API_KEY`, `ASSISTANT_AI_GEMINI_API_KEY`, `ASSISTANT_AI_OPENROUTER_API_KEY`. Keys are never required for local tests.
- Real publisher integrations, payouts and Gserver deployment are **not yet implemented**.

## Development
Node.js 22+; `npm test` runs dependency-free mock unit tests.
