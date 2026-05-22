# 02 — Rendezvous-hashed 2-of-N replication on upload

**Status:** proposed
**Priority:** P1 (depends on #01)
**Effort estimate:** 2–3 weeks
**Related research:** [RESEARCH.md §3](../RESEARCH.md#3--replication-and-placement)

## Problem

From [DESIGN.md §Non-goals](../DESIGN.md):
> Automatic file replication / eventual convergence of `data/` directories.

Consequence: every file lives on exactly one node. When that node goes down,
the file is gone from the fleet — even though the index still references it
until the dead-peer eviction tick.

## Proposal

Use **rendezvous hashing (HRW)** for deterministic placement, and write each
upload to **2 of N nodes** at receive time.

### Placement

For a file `f`, every node independently computes:
```
score(node) = hash(f.contentHash || node.id)
replicas(f) = top-K nodes by score
```

K=2 for a fleet of ≥3 nodes. Any node, given the peer list, computes the
same replica set without coordination.

### Write path

1. Upload arrives at node-A.
2. node-A computes `replicas(f)`.
3. If node-A ∈ replicas: write locally, then push to the other replica peer(s).
4. If node-A ∉ replicas: forward to one of the replicas, which then push-replicates as in step 3.
5. Respond `201 Created` only after **both** replica writes succeed (quorum=K).
6. On peer-down: accept the write to a designated **hint holder** (sloppy quorum / hinted handoff). Background reconciler hands off to the real target when it comes back.

### Read path

1. Reader hits node-A asking for `f`.
2. If node-A has `f` locally → serve.
3. Else node-A computes `replicas(f)` and proxies from the lowest-loaded live replica.

## Scope of work

- [ ] Add `placement.ts` with rendezvous hashing.
- [ ] Switch upload route to write-2-of-K with quorum confirmation.
- [ ] Add an internal `/replicate` endpoint (mTLS+bearer, fleet-internal only).
- [ ] Read path: pick replica by load metric (piggyback queue depth on gossip from #01).
- [ ] Hinted handoff: durable hints dir + background reconciler.
- [ ] Manifest entries gain `replicas: string[]` (which nodes hold the file).
- [ ] Conflict resolution: when two nodes upload same filename, use content hash as LWW tiebreaker (deterministic across the fleet).

## Design choices to confirm

- **K=2 vs K=3?** K=2 survives one node down; K=3 survives two. Recommend K=2 default, configurable.
- **Hash function?** Use the content hash from #03 if possible (single hash computation), else BLAKE3 of filename + version.
- **What if K > fleet size?** Clamp K to fleet size; surface a warning.
- **Eviction strategy when a node fills up?** Out of scope for v1 — track in a follow-up.

## Migration

- Existing single-replica files: background backfill task that walks each
  node's local store, computes `replicas(f)` for each file, and triggers
  replication for under-replicated files.

## Out of scope

- Erasure coding (deliberately rejected — see RESEARCH.md §3).
- Read-after-write linearizability (we are eventual consistency).
- Per-file replication factor override.

## Acceptance criteria

- Killing one node leaves every file still readable from the fleet.
- New uploads land on exactly K nodes (verified by manifest inspection).
- Hinted handoff completes within one gossip cycle of a downed node returning.
- Existing single-replica files are backfilled to K replicas within one full backfill pass.

## References

- [Rendezvous hashing — Wikipedia](https://en.wikipedia.org/wiki/Rendezvous_hashing)
- [Consistent vs Rendezvous Hashing — DZone](https://dzone.com/articles/consistent-hashing-vs-rendezvous-hashing-a-compara)
- [Dynamo paper — sloppy quorum / hinted handoff](https://www.cs.cornell.edu/courses/cs5414/2017fa/papers/dynamo.pdf)
