# Queue and Channel Points recovery

The server owns one checkpoint in `.artifacts/recovery/`, outside every runtime agent workspace and excluded from browser serving and Git. Its filename is derived from the demo/local scope or the Twitch broadcaster/client pair. No keys or tokens are written to it. Keep this directory on persistent storage, back it up privately, and run one server per checkpoint/reward.

## Write and settlement order

1. Validate/moderate intake. Save the redemption ID, reward ID and job linkage before admitting the job to the forge.
2. Independently verify the actual generated spec. Save the verified queue entry, job and current fight state using a synced temporary file and atomic rename. An uncommitted boss stays invisible and cannot be claimed.
3. Save the `FULFILLED` or `CANCELED` settlement intent before sending it to Twitch. Fulfillment waits for the queue/fight durability fence.
4. Persist completion only after Twitch confirms the requested status. If the result or the completion write is uncertain, retain the intent and retry; an already applied terminal status is confirmed with a status read.

All checkpoint writes are serialized across forge and redemption updates. A queue save failure prevents fulfillment and the failed request can be refunded. An outbox save failure prevents sending a new settlement. Successful refunds are announced only after confirmation. API tokens, raw provider responses, raw commands and private reasoning are never part of the checkpoint.

## Startup

Before HTTP intake or Twitch subscriptions start, Zod validates the bounded checkpoint, file identity and owner scope. Each saved queue/active-fight spec is run through the current independent gate, including deterministic command data previously compiled by the server. No script source executes during recovery. Metadata, spec hash, current policy and gate decision must agree; cached reports cannot certify a boss.

Restore the five-slot queue in order, retain manual approvals, and fail any generation interrupted before a verified queue commit. The active fight occupies its own slot and is marked resumable: **Retry interrupted fight from the same seed** restarts it with the original boss, seed and fight ID. Completed fight IDs remain bounded and suppress duplicate finish requests across restarts. Twitch recovery then settles known jobs and refunds orphaned unfulfilled deliveries before unpausing the reward.

Corruption, another owner's state or a saved boss failing today's gate stops startup without overwriting the checkpoint. Preserve the file for review. Never delete it merely to bypass a gate rejection. Twitch only permits status changes from `UNFULFILLED`, so an already fulfilled request cannot be automatically refunded after a later policy failure or storage loss. Old versions had no durable queue; this feature cannot reconstruct their vanished bosses.

This is at-least-once recovery, with a possible fight retry after a crash, rather than exactly-once play. It assumes the same private storage survives restart and that one process owns it. It does not recover a running simulation's position/HP or an in-progress Codex turn. Automated tests cover fresh-gate restart, full-queue active-fight retry, corrupted/unsafe state, settlement retries and storage failures using temporary files and injected Twitch transports.
