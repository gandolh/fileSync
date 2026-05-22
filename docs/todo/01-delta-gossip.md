# 01 — Replace full-manifest polling with Scuttlebutt delta-gossip

**Status:** proposed
**Priority:** P0 (foundation for #02 and #03)
**Effort estimate:** 1–2 weeks
**Related research:** [RESEARCH.md §2](../RESEARCH.md#2--membership--gossip)

## Problem

Today (see [DESIGN.md §Sync strategy](../DESIGN.md)):
- Every node `GET /manifest` from every other node every 30s.
- O(N²) HTTP calls per tick; each call ships the **whole** manifest.
- A peer going down is only detected when its next request fails — no liveness signal between ticks.
- An upload on node-A is invisible to node-B for up to `syncIntervalMs`.

## Proposal

Implement a Scuttlebutt-style delta-gossip protocol over the existing
mTLS+bearer peer channel:

1. Each node maintains a versioned KV store: `(filename) → (manifestEntry, version)`.
2. On each gossip tick, a node picks one random peer and exchanges digests
   (`{filename: version}`), then sends only the entries the peer is behind on.
3. Peer liveness is tracked by last-successful-gossip timestamp; missing
   N consecutive ticks marks the peer suspect, then dead.

## Scope of work

- [ ] Add a per-node monotonic version counter (clock) to `index-store.ts`.
- [ ] New `/gossip/digest` endpoint — returns `{filename: version}` for this node's slice.
- [ ] New `/gossip/pull` endpoint — accepts `{filename: version}` and returns entries newer than the supplied versions.
- [ ] Replace `sync.ts` periodic full-pull with a random-peer gossip tick (default 1s).
- [ ] Track per-peer liveness; expose state on `/health`.
- [ ] Drop a peer's slice on dead transition (preserve current behavior).
- [ ] Backwards compat: keep `/manifest` for one release so a partial-upgrade fleet still works.

## Design choices to confirm

- **Push vs pull vs push-pull?** Push-pull (digest exchange) is what Scuttlebutt does and tolerates asymmetric NAT — but our nodes are operator-controlled and reachable both directions, so plain pull-with-digest is simpler. Recommend pull-with-digest.
- **Fanout per tick?** Start with 1 random peer per tick at 1s interval. Convergence time is `O(log N)` ticks.
- **Version scheme?** Local Lamport counter per (node, filename) is enough — we don't need vector clocks because each node is sole writer of its own namespace.

## Out of scope (handled by later items)

- Multi-writer per filename (deferred to #02 replication design).
- Membership / peer discovery (still static `peers.json` for now).
- SWIM-style indirect pings (failure detection via missing-gossip is enough at this scale).

## Acceptance criteria

- A single-file change on node-A appears on node-B in under 2× tick interval (measured).
- Network traffic per tick is proportional to the number of *changed* entries, not the total fleet size.
- Killing a node is detected within `N × tickInterval` (configurable N, default 3).
- All existing tests pass; new tests cover convergence + dead-peer eviction.

## References

- [Efficient Reconciliation and Flow Control for Anti-Entropy Protocols — van Renesse](https://www.cs.cornell.edu/home/rvr/papers/flowgossip.pdf)
- [Quickwit Chitchat — production Scuttlebutt in Rust](https://quickwit.io/blog/chitchat)
