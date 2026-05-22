# fileSync — Decentralized Storage Research

> **⚠️ Read this first:** This document was written under the original framing
> of fileSync as a **single-operator mesh** (one person runs 3–10 nodes). The
> project has since pivoted to a **federation of trusted persons** (5–50
> friends, each running their own node, sharing libraries Plex-style). See
> [RESEARCH-FEDERATION.md](RESEARCH-FEDERATION.md) for that direction.
>
> The technical ideas below (gossip, replication, content addressing) are
> still valid building blocks — they just operate at a different layer now.
> The trust/identity/auth parts (shared bearer, private CA) are **superseded**
> by the federation model.

Survey of academic papers and production designs for decentralized / peer-to-peer
/ federated file storage, scoped to ideas that could realistically improve
fileSync. We are a **small operator-controlled mesh** (3–10 nodes, one
operator, private CA), not a public permissionless network — so the
blockchain / proof-of-storage / sybil-resistance / token-incentive literature
is deliberately out of scope.

For what fileSync currently does, see [DESIGN.md](DESIGN.md). For concrete
follow-up work, see [todo/](todo/).

---

## 1. Content-addressed storage / chunking

| System | Reference | Idea worth borrowing | Cost |
| --- | --- | --- | --- |
| IPFS | [Benet, arXiv 1407.3561](https://arxiv.org/abs/1407.3561) | Identify blocks by hash of content → dedup, tamper-evidence, cache-anywhere | Filename → CID indirection layer; rename/delete bookkeeping |
| Iroh blobs | [iroh-blobs design](https://www.iroh.computer/blog/blob-store-design-challenges) | BLAKE3 tree → cryptographically verify arbitrary byte-ranges without downloading the whole file | Outboard sidecar (~1/500th of data) must be stored and shipped alongside blobs |
| Tahoe-LAFS | [Architecture](https://tahoe-lafs.readthedocs.io/en/tahoe-lafs-1.12.1/architecture.html) | Capability strings encode both location and decryption key — read-cap vs write-cap split avoids server-side ACLs | Immutable by default; mutable files require separate "slot" abstraction |

**Takeaway:** Content addressing buys integrity verification on every read and
the ability to cache/serve from any node that has seen the bytes (not just the
uploader). The cost is one indirection: filenames become aliases over hashes.

---

## 2. Membership / gossip

| System | Reference | Idea worth borrowing | Cost |
| --- | --- | --- | --- |
| SWIM | [Das/Gupta/Motivala (Cornell)](https://www.cs.cornell.edu/projects/Quicksilver/public_pdfs/SWIM.pdf) | Decouple failure detection (ping + indirect ping) from membership dissemination (piggyback updates) → O(1) detection time | UDP machinery; probabilistic detection window (a few RTTs) |
| Scuttlebutt | [van Renesse et al. (Cornell)](https://www.cs.cornell.edu/home/rvr/papers/flowgossip.pdf), [Quickwit Chitchat](https://quickwit.io/blog/chitchat) | Delta gossip ordered by version, newest first — only ship changed entries | Eventual convergence; index can be one gossip interval stale |
| HyParView + Plumtree | [HyParView](https://www.researchgate.net/publication/4261663_HyParView_A_Membership_Protocol_for_Reliable_Gossip-Based_Broadcast), [Plumtree](https://asc.di.fct.unl.pt/~jleitao/pdf/srds07-leitao.pdf) | Spanning tree over O(log N) active peers, gossip fallback on tree failures | Overkill below ~50 nodes |

**Takeaway:** Today fileSync polls full manifests over HTTP from every peer
every 30s — O(N²) and no failure detection. SWIM + Scuttlebutt would replace
both with one mechanism in a few hundred lines of code. Plumtree is for later.

---

## 3. Replication and placement

| System | Reference | Idea worth borrowing | Cost |
| --- | --- | --- | --- |
| Rendezvous (HRW) hashing | [Wikipedia](https://en.wikipedia.org/wiki/Rendezvous_hashing), [DZone comparison](https://dzone.com/articles/consistent-hashing-vs-rendezvous-hashing-a-compara) | For each file, `score = hash(filename + node_id)`; pick top-K scorers as replica targets | O(N) per placement decision (irrelevant for N≤10); needs write-coordination |
| Dynamo | [DeCandia et al. (Cornell)](https://www.cs.cornell.edu/courses/cs5414/2017fa/papers/dynamo.pdf), [Vogels](https://www.allthingsdistributed.com/2007/10/amazons_dynamo.html) | Sloppy quorum + hinted handoff — if target is down, another node accepts with a hint and forwards on recovery | Durable hint storage; background reconciler |
| Reed-Solomon erasure coding | [Backblaze](https://www.backblaze.com/blog/reed-solomon/), [Storj](https://www.storj.io/blog/replication-is-bad-for-decentralized-storage-part-1-erasure-codes-for-fun-and-profit), [Tahoe-LAFS encoding](https://tahoe-lafs.readthedocs.io/en/tahoe-lafs-1.12.1/specifications/file-encoding.html), [CRUSH (Ceph)](https://ceph.com/assets/pdfs/weil-crush-sc06.pdf) | Storage-efficient durability (e.g. 3-of-5) — survives K failures with less than K× space | Reads require K survivors to cooperate; only wins past ~8 heterogeneous nodes |

**Takeaway:** At 3–10 nodes, **2-of-3 replication beats Reed-Solomon**: same
durability, simpler reads, lower latency. Rendezvous hashing is the right
placement function — simpler than Dynamo's ring, deterministic, any node can
compute it from the peer list with no coordination.

---

## 4. Conflict-free convergence

| System | Reference | Idea worth borrowing | Cost |
| --- | --- | --- | --- |
| CRDTs | [Shapiro et al., arXiv 1805.06358](https://arxiv.org/pdf/1805.06358), [crdt.tech](https://crdt.tech/) | LWW-Register keyed by (filename, node) → conflict-free merge of the virtual index, no consensus | Simultaneous same-name writes silently lose one (mitigate with content hash tiebreaker) |
| Earthstar | [earthstar-project/earthstar](https://github.com/earthstar-project/earthstar) | TypeScript-native, designed for small trusted groups; documents = `(path, author_keypair) → (value, timestamp, signature)` | Requires migrating the file index into Earthstar's document model |
| Hypercore / Dat | [DEP-0002](https://www.datprotocol.com/deps/0002-hypercore/), [DEP-0008 Multi-Writer](https://www.datprotocol.com/deps/0008-multiwriter/), [holepunchto/hypercore](https://github.com/holepunchto/hypercore) | Each node owns one signed append-only Merkle log → causal ordering, sparse replication | Event-log model heavier than needed for a flat file index |

**Takeaway:** A LWW-Register CRDT keyed by `(filename, node)` is the minimum
viable convergence mechanism — each node is sole writer of its own namespace,
merges are a max over per-node version counters. Pairs naturally with delta
gossip.

---

## 5. Permissioned trust (private-CA mesh)

| System | Reference | Idea worth borrowing | Cost |
| --- | --- | --- | --- |
| SPIFFE / SPIRE | [spiffe.io](https://spiffe.io/docs/latest/spiffe-about/overview/), [CNCF self-assessment](https://tag-security.cncf.io/community/assessments/projects/spiffe-spire/self-assessment/) | Short-lived X.509-SVIDs (1h TTL), auto-rotated; identity in SAN URI, not shared bearer | SPIRE server is infra dependency; startup ordering (no SVID → no connections) |
| Tailscale | [How it works](https://tailscale.com/blog/how-tailscale-works) | Control plane only sees public keys, never data — lightweight coordinator distributes node pubkeys | Single point of failure for key distribution (but not for serving data) |

**Takeaway:** Our threat model (operator-controlled fleet, no public CA) is
exactly what SPIFFE was designed for. SPIRE is operationally heavy for a
small fleet; a Tailscale-style in-process coordinator is the lighter path to
dropping the shared bearer token in favor of per-node asymmetric auth.

---

## 6. Caching / proxying strategy

| System | Reference | Idea worth borrowing | Cost |
| --- | --- | --- | --- |
| NGINX slice module | [NGINX byte-range caching](https://blog.nginx.org/blog/smart-efficient-byte-range-caching-nginx), [Kevin Cox](https://kevincox.ca/2021/06/04/http-range-caching/) | Decompose arbitrary `Range:` requests into fixed-size aligned blocks (e.g. 1 MiB) keyed by `(file_id, block_index)` | Local block cache with eviction; correct 206 + Content-Range assembly |
| CoralCDN | [NSDI 2010](https://www.cs.princeton.edu/~mfreed/docs/coral-nsdi10.pdf), [sloppy hashing](https://www.cs.princeton.edu/~mfreed/docs/coral-iptps03.pdf) | Load-aware routing: prefer nearest replica that has the object AND is below load threshold | Piggyback a load metric on heartbeats; small routing decision per read |

**Takeaway:** Today the proxy path serves uncached and supports no ranges.
Slice-aligned block caching is the canonical fix — turns video seeking and
overlapping range requests from misses into hits. Load-aware routing only
becomes meaningful once #3 (replication) is in.

---

## 7. Recent work (2022–2025)

| System | Reference | Idea worth borrowing | Cost |
| --- | --- | --- | --- |
| Iroh | [A New Direction](https://n0.computer/blog/a-new-direction-for-iroh/), [iroh-blobs](https://github.com/n0-computer/iroh-blobs), [iroh-docs](https://github.com/n0-computer/iroh-docs) | Modular stack: `iroh-docs` does range-based set reconciliation for KV sync; `iroh-blobs` does BLAKE3 verified streaming | Rust-native (would need bindings or hand-port to TS) |
| Earthstar v10+ | [GitHub](https://github.com/earthstar-project/earthstar), [Rules](https://github.com/earthstar-project/earthstar-docs/blob/main/docs/intro/rules-of-earthstar.md) | TS-native, transport-agnostic (HTTP/WS/sneakernet), per-author Ed25519 signatures, LWW per (path, author) | Lose direct filesystem-path addressing; files become document values |
| van Renesse 2008 | [ACM DL](https://dl.acm.org/doi/10.1145/1529974.1529983) | Still-canonical anti-entropy paper; Chitchat is the production reference | None — read it before implementing #1 |

---

## What we should steal first — ranked

### 1. Scuttlebutt delta-gossip to replace manifest polling
**Why first:** Highest impact, lowest risk. Replaces O(N²) full-manifest HTTP
pulls with incremental delta exchange. Adds implicit failure detection (no
gossip = peer is gone). Clean foundation for everything else. ~300–500 lines
of Node. See [todo/01-delta-gossip.md](todo/01-delta-gossip.md).
Reference: [Chitchat](https://quickwit.io/blog/chitchat), [van Renesse flowgossip](https://www.cs.cornell.edu/home/rvr/papers/flowgossip.pdf).

### 2. Rendezvous hashing + 2-of-N replication on upload
**Why second:** Kills the biggest operational risk in DESIGN.md — "a file
lives on exactly one node." Deterministic placement, no consensus, every
node computes it from the peer list. Use content hash as LWW tiebreaker. ~100
lines of placement logic + write coordination. See [todo/02-rendezvous-replication.md](todo/02-rendezvous-replication.md).
Reference: [Rendezvous hashing](https://en.wikipedia.org/wiki/Rendezvous_hashing).

### 3. BLAKE3 outboard + byte-range support on the proxy path
**Why third:** Solves two open questions from DESIGN.md at once — range
requests for video seeking AND integrity guarantees on proxied reads. Per-chunk
verification means we catch silent corruption on a peer's filesystem. See
[todo/03-blake3-ranges.md](todo/03-blake3-ranges.md).
Reference: [iroh-blobs blob store design](https://www.iroh.computer/blog/blob-store-design-challenges).

## What we deliberately do NOT recommend

- **Erasure coding** — wrong scale. Replication wins below ~8 nodes.
- **Plumtree / HyParView** — wrong scale. SWIM + Scuttlebutt suffice below 50 nodes.
- **Full IPFS or Hypercore** — heavier than fileSync's goals.
- **SPIRE** — good idea, operationally heavy. Try a Tailscale-style in-process coordinator first.
- **Blockchain / proof-of-storage / token incentives** — wrong threat model. We trust the fleet operator.

---

## All sources

- [IPFS — Content Addressed, Versioned, P2P File System (Benet, arXiv 1407.3561)](https://arxiv.org/abs/1407.3561)
- [SWIM: Scalable Weakly-consistent Infection-style Process Group Membership](https://www.cs.cornell.edu/projects/Quicksilver/public_pdfs/SWIM.pdf)
- [Dynamo: Amazon's Highly Available Key-value Store](https://www.cs.cornell.edu/courses/cs5414/2017fa/papers/dynamo.pdf)
- [Amazon's Dynamo (Vogels blog)](https://www.allthingsdistributed.com/2007/10/amazons_dynamo.html)
- [Tahoe-LAFS Architecture](https://tahoe-lafs.readthedocs.io/en/tahoe-lafs-1.12.1/architecture.html)
- [HyParView: A Membership Protocol for Reliable Gossip-Based Broadcast](https://www.researchgate.net/publication/4261663_HyParView_A_Membership_Protocol_for_Reliable_Gossip-Based_Broadcast)
- [Epidemic Broadcast Trees / Plumtree](https://asc.di.fct.unl.pt/~jleitao/pdf/srds07-leitao.pdf)
- [Efficient Reconciliation and Flow Control for Anti-Entropy Protocols (ACM DL)](https://dl.acm.org/doi/10.1145/1529974.1529983)
- [Efficient Reconciliation (Scuttlebutt) — Cornell](https://www.cs.cornell.edu/home/rvr/papers/flowgossip.pdf)
- [Quickwit Chitchat](https://quickwit.io/blog/chitchat)
- [CRDT overview — crdt.tech](https://crdt.tech/)
- [Conflict-free Replicated Data Types (Shapiro et al., arXiv 1805.06358)](https://arxiv.org/pdf/1805.06358)
- [Earthstar](https://github.com/earthstar-project/earthstar)
- [Earthstar rules of the protocol](https://github.com/earthstar-project/earthstar-docs/blob/main/docs/intro/rules-of-earthstar.md)
- [Hypercore DEP-0002](https://www.datprotocol.com/deps/0002-hypercore/)
- [Hypercore DEP-0008 Multi-Writer](https://www.datprotocol.com/deps/0008-multiwriter/)
- [holepunchto/hypercore](https://github.com/holepunchto/hypercore)
- [SPIFFE Overview](https://spiffe.io/docs/latest/spiffe-about/overview/)
- [SPIFFE/SPIRE CNCF Self-Assessment](https://tag-security.cncf.io/community/assessments/projects/spiffe-spire/self-assessment/)
- [Tailscale: How it works](https://tailscale.com/blog/how-tailscale-works)
- [NGINX Smart Byte-Range Caching](https://blog.nginx.org/blog/smart-efficient-byte-range-caching-nginx)
- [The Impossibility of Perfectly Caching HTTP Range Requests (Kevin Cox)](https://kevincox.ca/2021/06/04/http-range-caching/)
- [CoralCDN — NSDI 2010](https://www.cs.princeton.edu/~mfreed/docs/coral-nsdi10.pdf)
- [Sloppy hashing and self-organizing clusters (CoralCDN iptps03)](https://www.cs.princeton.edu/~mfreed/docs/coral-iptps03.pdf)
- [Iroh — A New Direction](https://n0.computer/blog/a-new-direction-for-iroh/)
- [iroh-blobs blob store design](https://www.iroh.computer/blog/blob-store-design-challenges)
- [n0-computer/iroh-blobs](https://github.com/n0-computer/iroh-blobs)
- [n0-computer/iroh-docs](https://github.com/n0-computer/iroh-docs)
- [Rendezvous hashing — Wikipedia](https://en.wikipedia.org/wiki/Rendezvous_hashing)
- [Consistent vs Rendezvous Hashing — DZone](https://dzone.com/articles/consistent-hashing-vs-rendezvous-hashing-a-compara)
- [Backblaze Reed-Solomon](https://www.backblaze.com/blog/reed-solomon/)
- [Storj: Replication is bad for decentralized storage](https://www.storj.io/blog/replication-is-bad-for-decentralized-storage-part-1-erasure-codes-for-fun-and-profit)
- [Tahoe-LAFS file encoding](https://tahoe-lafs.readthedocs.io/en/tahoe-lafs-1.12.1/specifications/file-encoding.html)
- [CRUSH: Controlled, Scalable, Decentralized Placement (Ceph)](https://ceph.com/assets/pdfs/weil-crush-sc06.pdf)
- [BLAKE3 — provable data possession discussion](https://github.com/BLAKE3-team/BLAKE3/issues/146)
