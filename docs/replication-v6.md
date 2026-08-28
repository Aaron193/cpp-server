# Protocol v6 replication contract

`SnapshotDelta` is an ordered WebSocket replication stream. An entity is
identified by `EntityHandle { slot, generation }`; consumers must key views by
both values. Slot reuse therefore creates a new view and cannot mutate a stale
generation.

For a normal delta, `baselineSequence` is exactly the immediately previous
`SnapshotDelta.snapshotSequence` that the client applied on that connection,
and `baselineRevision` is unchanged. There is no client acknowledgement because
WebSocket is reliable and ordered. A decoder rejects unknown handles, stale or
missing baselines, and any `UpdatedEntity` whose optional-field presence does
not exactly match `changeMask`.

A reset delta has `baselineReset=true`, `baselineSequence=0`, a new
`baselineRevision`, and a complete `created` set for every currently relevant
remote entity. The client clears its replication table before applying it.
Reconnect and decoder failure clear client state. The server also emits a reset
when low-priority snapshots were coalesced, ensuring a retained snapshot never
depends on one that was not sent.

`local` is recipient-private and always contains the owner's authoritative
transform, health, and weapon/ammo state. `created` and `updated` are public and
contain no health or ammo fields. `removed` carries a handle and reason.
Lifecycle `Spawn`/`Remove` messages use the same versioned handles; reliable
combat/score events remain ordered and use the v6 action correlation IDs.

Players are globally relevant in the current capped twelve-player mode. The
interest policy exposes spatial enter/leave thresholds for props and spectators
(50 m enter, 55 m leave hysteresis) and a client-ID-staggered periodic refresh
predicate (ten snapshots by default). The current player scan is bounded; future
prop grids can use the same handle/delta contract without a protocol change.

Reliable events are queued in a bounded deque and sent before state. The native
transport reports uWebSockets' actual buffered amount. Above 128 KiB, state is
coalesced to the latest reset delta; the existing 256 KiB byte/message hard cap
remains the final close boundary. Metrics include socket-buffer high water,
outbound queue high water, snapshot size, and coalesced snapshot count.
