# Twitch and OBS setup (M4)

Run `npm run demo` for a complete local overlay with simulated viewers. Demo never connects to Twitch, including on a machine with saved Twitch tokens. Cached forge work remains labeled **CACHED REPLAY / NO LIVE CODEX**; a supplied Codex key can still enable real generation with simulated viewers. Set `FORGE_MODE=replay` to force offline generation.

## Authorize accounts

1. Register a confidential application in the [Twitch developer console](https://dev.twitch.tv/console/apps). Register the exact redirect `http://localhost:8787/auth/callback` (or your configured loopback port).
2. Copy `.env.example` to ignored `.env.local`. Set `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`. Stop the game server while the auth helper uses its callback port.
3. Run `npm run auth -- broadcaster`. Open its printed authorization link and sign in as the broadcaster. Consent saves the user ID and both tokens locally.
4. Run `npm run auth -- bot`. Use the bot account for this authorization. Both roles may use the same account if desired. Existing configured IDs must match the authorizing account; clear the appropriate ID first if deliberately changing accounts.
5. Set `TWITCH_ENABLED=true`. Supply a Codex key for live forging, or explicitly use `FORGE_MODE=replay` to test Twitch intake with clearly labeled cached templates. Start `npm run server`.

The helper binds only to loopback, checks callback host and one-use, ten-minute OAuth state, verifies the user/client/scopes, and writes `.env.local` atomically. It does not print credentials. The server validates both owners at startup and hourly; 401 handling coalesces refreshes and persists both rotated tokens before use. Invalid grants stop Twitch sessions; local play remains available. Reauthorize and restart to restore the connection. No server token is included in browser snapshots, Vite variables, or agent environments.

This installed application uses **user-token WebSockets**, with one socket per role: bot for chat, broadcaster for redemptions. The requested scopes are deliberately smaller than the initial cloud-bot brief: bot `user:read:chat user:write:chat`; broadcaster `channel:manage:redemptions channel:manage:broadcast clips:edit`. App-token cloud-bot grants (`user:bot`, `channel:bot`) and redundant `channel:read:redemptions` are unnecessary for this transport. User-token replies also appear in participating Shared Chat channels; inbound commands originating in another channel are ignored.

## Reward and approvals

The server discovers only rewards manageable by this client ID, or creates **Forge a Boss** at `TWITCH_REWARD_COST` (default 1000). It requires input and preserves the redemption queue. An explicitly configured foreign/missing reward ID is rejected; clear `TWITCH_REWARD_ID` to discover/create an app-owned reward. The ID is saved locally. A paused reward stays paused until its subscription and recovery succeed. Graceful shutdown pauses it again. Twitch Channel Points require an eligible Affiliate/Partner channel; unavailable rewards leave `!boss` chat intake working.

All requests use the existing server state machine and minute cooldown. Manual approval is the default; `AUTO_APPROVE=true` explicitly opts out. Viewer descriptions remain data, and the server alone decides whether the actual in-memory spec passes the gate. Failed/rejected/invalid/cooldown requests are canceled and refunded. A redemption is fulfilled when its verified boss enters the queue. Receipt and refund messages do not claim success before Twitch confirms the corresponding status.

| Command | Who | Result |
| --- | --- | --- |
| `!boss <5–1000 character description>` | Viewer | Submit an idea; returns full request ID |
| `!queue` | Viewer | Current verified queue; channel reply cooldown |
| `!vote <1-3>` | Viewer | Vote in an open "next boss" poll; silent, last vote counts |
| `!rematch` | Viewer | Call a Rematch Patch after a win (`REMATCH_VOTES` needed; the creator or a mod counts as enough alone) |
| `!top` / `!record` / `!mybosses` | Viewer | Hall of Fame, streamer record, your own bosses (10 s channel cooldown for `!top`/`!record`) |
| `!startvote` | Broadcaster/moderator | Open a poll now (needs 2+ queued bosses) |
| `!approve [code]` | Broadcaster/moderator | Approve a pending request by its short code (`!approve 67cb`), or the oldest pending one with no code. Full IDs also work. |
| `!reject [code]` | Broadcaster/moderator | Reject a pending request (same codes); cancel its points redemption |
| `!skip` | Broadcaster/moderator | Close the active fight, including on the play page |

Moderator authority comes from Twitch user IDs/badges, never the message text. Bot echoes and reward chat messages cannot create duplicate jobs. Notification and chat IDs are deduplicated with bounded histories. WebSocket reconnect handoff keeps the old connection until the new welcome; inherited subscriptions are not recreated. Unexpected disconnects recreate subscriptions with backoff and a keepalive deadline. Reconnect destinations are restricted to Twitch's EventSub host. Revoked subscriptions stop that socket and require reauthorization/restart.

The verified queue, active fight, bounded job history and redemption linkage/settlement outbox are persisted together under ignored `.artifacts/recovery/`. The server saves a verified boss before exposing it as queued or fulfilling its redemption. On restart it validates the checkpoint and independently reruns the current gate on each saved boss; cached pass claims are ignored. An interrupted fight is offered in the arena as **Retry interrupted fight from the same seed**, separately from the five queued bosses. An interrupted build fails and its unfulfilled redemption is refunded; pending manual approvals stay pending. Unknown unfulfilled deliveries are also refunded. Settlements retry every 30 seconds, including uncertain updates that Twitch may already have applied. A status read confirms the requested terminal status before marking the outbox item done.

Keep `.artifacts/recovery/` on persistent storage and include it in private backups. Demo, local-only and each broadcaster/client pair use separate checkpoints. A corrupt/wrong-owner checkpoint or a saved boss failing the fresh gate blocks startup and retains the file for operator review; it never silently clears paid requests or weakens the gate. Twitch cannot cancel an already fulfilled redemption, so preserve a rejected checkpoint and resolve such cases with the broadcaster. No pre-existing fulfilled queue can be recovered from versions that never saved it. Do not run two instances against the same reward or checkpoint. Recovery provides at-least-once availability: a crash around fight completion can require retrying that fight. It does not promise exactly-once gameplay or immunity to lost storage. If access is revoked, resolve outstanding redemptions in the Twitch dashboard before reconnecting. See [recovery details](recovery.md).

## OBS and highlights

Add a **Browser Source**, URL `http://127.0.0.1:8787/overlay/`, width **1920**, height **1080**, at 30 or 60 FPS. Keep the background transparent; don't add an opaque custom stylesheet. Capture `/play/?capture` separately with a window capture: capture mode hides the page chrome and letterboxes the arena to fill the window. (`/play/?autopilot` lets the gate's reference bot play, labelled on screen, for demos.) Keyboard/gamepad input belongs to the play page. The overlay never claims fights or sends WebSocket messages.

The overlay shows the current/next verified boss, source quote, three interpretation bullets, standard-difficulty gate metrics, queue, forge ticker, connection state, and expiring toasts. The middle remains transparent for gameplay. At smaller browser sizes it scales the entire broadcast layout. Disconnects label the frozen display. It renders viewer strings as text, using original procedural portraits from the game renderer.

Finish a **server-claimed** fight with a boss kill or player death to request a clip and stream marker. Practice retries and skipped fights do not create highlights. Clip requests are labeled pending until Get Clips confirms them (up to 60 seconds). Offline streams, disabled clips/VODs, missing permissions and timeouts produce nonfatal toasts. In demo mode these are explicitly preview events; no Twitch API calls or fake clip links are made.

## Verification and remaining limits

M4 uses injected HTTP/socket transports for OAuth ownership, refresh/rate handling, reward ownership, moderator commands, deduplication, reconnects, settlement, and clip confirmation tests. The adapter integration test exercises separate subscriptions, a real coordinator approval/gate/queue transition, fulfillment, snapshot validation, secret exclusion, and disconnect pausing. Browser QA uses the account-free demo and overlay.

Live Twitch authorization, delivery, refunds and OBS desktop capture require the operator's accounts/stream and have not been exercised in this environment. The existing Windows Codex sandbox verification limit still applies; see [forge.md](forge.md). M5 adds API moderation before intake and isolated script compilation. API failures/flags admit no job and cancel the corresponding redemption; without a platform key, explicitly labeled manual review remains mandatory even if auto-approval is configured.

The pulled dependency lock currently reports 11 moderate npm audit findings in the development lint/minimatch chain. M4 retains those pinned versions; npm's proposed automatic fix includes unrelated major version downgrades.
