# fileSync — Action items

Concrete follow-up work for fileSync. The project has pivoted from
**single-operator mesh** to **federation of trusted persons**
(Plex-for-friends). See [RESEARCH-FEDERATION.md](../RESEARCH-FEDERATION.md)
for the framing and [RESEARCH.md](../RESEARCH.md) for the earlier survey on
storage / gossip / replication building blocks (still valid as building
blocks, layered under the federation model).

## Items

| # | Item | Priority | Depends on |
| --- | --- | --- | --- |
| [01](01-delta-gossip.md) | Delta-gossip replaces manifest polling | P0 | — |
| [02](02-rendezvous-replication.md) | Rendezvous-hashed 2-of-N replication | P1 | #01 |
| [03](03-blake3-ranges.md) | BLAKE3 outboard + byte-range proxy | P1 | — |
| [04](04-keypair-identity.md) | Per-user Ed25519 keypair as identity | P0 | — |
| [05](05-friend-add-ceremony.md) | Wormhole-style add-friend ceremony | P0 | #04 |
| [06](06-capability-tokens.md) | Biscuit/UCAN capability tokens (replaces shared bearer) | P0 | #04, #05 |
| [07](07-relay-connectivity.md) | Relay-first connectivity (Tailscale pattern) | P0 | #04 |
| [08](08-playback-state.md) | Playback state on viewer's node, not content host | P1 | #04, #09 |
| [09](09-catalog-sync-crdt.md) | Catalog + metadata as CRDT over the friend graph | P1 | #04, #06, composes with #01 |

## Dependency graph

```
              ┌── #04 (keypair identity) ───────────────────────────┐
              │                                                     │
              │                                                     ▼
              ├──▶ #05 (friend-add)                     #08 (playback state)
              │     │                                     ▲
              │     ▼                                     │
              ├──▶ #06 (capability tokens) ─────▶ #09 (catalog CRDT)
              │                                     ▲
              ├──▶ #07 (relay / connectivity)       │
              │                                     │
              └─────────────────────────────────────┘
                                                    │
                                                    ▼
              #01 (delta gossip) ──┬─▶ #02 (rendezvous replication)
                                   │
              #03 (BLAKE3) ────────┴─▶ used by #09 (content hashes for catalog keys)
```

## Suggested phasing

**Phase 1 — Federation primitives (P0):** #04 → #05 → #06 → #07. Once these
land, fileSync has identities, can add friends, can issue scoped capabilities,
and can reliably reach friends behind NAT. This is the minimum viable
federation pivot.

**Phase 2 — Catalog + content (P1):** #03 → #09 → #01 (in any order, all can
proceed in parallel). Catalog sync, metadata enrichment, content-addressed
streaming. After this, friends can actually browse and stream each other's
libraries.

**Phase 3 — Polish + resilience (P1):** #02 (replication for the user's own
multi-node setups) and #08 (playback state on viewer's node). #08 is gated by
#09 — we need a catalog before there's state to track.

## Backlog (not yet sized)

Items captured for later, not commitments. See parent research docs for context.

- **WebFinger handle** — map `alice@her-media-box.home` → pubkey. Quality-of-life on top of #04.
- **Recovery key flows** — rotate signing key with offline recovery key (referenced by #04, not designed yet).
- **Group capabilities** — "book-club" caps that everyone in a defined group gets. Defer until friend counts justify it.
- **Bandwidth metering / quotas per friend** — Biscuit policy can express it; enforcement infra is separate work.
- **Transcoding strategy** — current default is "direct-play; client handles codec." Revisit if real-world users hit problems.
- **Federated search** — query across multiple friends' catalogs in one shot. Builds on #09.
- **Plex / Jellyfin metadata import** — onboarding sweetener.
- **Mobile / push wake-up** — wake a sleeping phone-hosted node. Big rabbit hole.
- **Per-node size budget + eviction** — referenced in DESIGN.md open questions.
- **Erasure coding** — explicitly deferred. Only revisit past ~8 nodes per principal.
