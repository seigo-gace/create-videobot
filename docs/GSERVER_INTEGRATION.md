# Gserver connection / first deployment stage

The authoritative Gserver contract is `seigo-gace/G-ACEserver/docs/architecture/BOT_TGS_BRIDGE.md`.
Do not duplicate the existing Gateway or TGserver ZERO queue.

`postGserverEvent` sends **operational metadata only** to Gserver `POST /bot/events`, authenticated by the **Bot-only** bearer, never Gserver's owner token. It never sends text, Telegram chat or user IDs, media identifiers, payment records, Stars values, AI prompts or API keys. HTTP 202 is **Gserver local durable queue** acknowledgment, not Gateway or TGserver delivery. On 401/409/503 no silent success or automatic mutation.

Current adapter source is not a running service. Gserver currently requires an explicit authorized private Docker network connection; its packaged `network_mode: none` does not make another service's HTTP requests magically reachable. Do not open public ports, mount Gserver Docker socket, copy owner credentials, or restart existing running services.

## Required deployment gates
1. Verify actual WSL Docker Compose service health, immutable image and rollback state on Master PC.
2. Verify the existing private Gserver Bot-only token mechanism without printing its value; provide this service access only to that token via an approved secret injection path.
3. Verify actual private network reachability of the Bot container to Gserver. Do not use a public API or cross-project Cloudflare zone as shortcut.
4. Verify local HTTP 202, durable queue, restart/replay and failure behavior.
5. Separately verify Gateway receipt, TGserver P015 raw and search delivery. Never equate them with local HTTP 202.
6. Keep Telegram real token, paid-media purchases, seller/purchaser identities and transactions out of logs.
7. Verify environment startup without GitHub connectivity.

No real production integration is claimed by these unit tests.
