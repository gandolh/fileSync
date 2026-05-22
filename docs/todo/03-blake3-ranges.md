# 03 — BLAKE3 outboard + byte-range support on the proxy path

**Status:** proposed
**Priority:** P1 (independent of #02; can ship in parallel)
**Effort estimate:** 1–2 weeks
**Related research:** [RESEARCH.md §1](../RESEARCH.md#1--content-addressed-storage--chunking), [RESEARCH.md §6](../RESEARCH.md#6--caching--proxying-strategy)

## Problem

From [DESIGN.md §Open questions](../DESIGN.md):
> Range requests on `/files/:name` so video previews can seek.

Plus two implicit problems:
- No integrity check on proxied reads — if a peer's filesystem silently
  corrupts a file, we serve corrupted bytes to the user.
- No caching of proxied reads — every read of a non-local file is a full
  fleet-internal transfer.

## Proposal

1. **Hash on upload.** Compute BLAKE3 of every uploaded file, store the
   outboard tree (sidecar, ~1/500th the size of the data) next to the blob.
2. **Range-aware proxy.** Support `Range:` requests on `/files/:name`. The
   serving node verifies each chunk against the BLAKE3 tree as it streams,
   so the proxy node can validate received bytes without trusting the peer.
3. **Slice-aligned cache.** When proxying, cache fetched bytes in fixed
   1 MiB blocks keyed by `(contentHash, blockIndex)`. Overlapping or
   sequential range requests become cache hits.

## Scope of work

### Upload path
- [ ] Hash uploads with BLAKE3 streaming as bytes arrive.
- [ ] Store outboard sidecar at `data/.outboard/<filename>.bao` (or similar).
- [ ] Add `contentHash` field to manifest entries.

### Serve path (local files)
- [ ] Implement `Range:` support on `GET /files/:name`.
- [ ] Return `206 Partial Content` with correct `Content-Range`.
- [ ] Verify chunks against outboard before streaming (cheap, already computed).

### Proxy path (peer-owned files)
- [ ] Forward `Range:` headers to the owning replica.
- [ ] Verify received chunks against the outboard before relaying to client (the outboard travels with the manifest entry — small enough).
- [ ] Cache verified chunks in `cache/<contentHash>/<blockIndex>` with LRU eviction (size budget configurable, default 1 GiB).

### Misc
- [ ] If a chunk fails verification: log + fail the read + mark the source replica suspect.
- [ ] Background "scrub" task: re-verify a small fraction of local files per day; auto-repair from a replica (depends on #02) if local copy is corrupt.

## Design choices to confirm

- **Why BLAKE3 over SHA-256?** Tree structure enables per-chunk verification on streaming reads. SHA-256 is whole-file only.
- **Block size?** 1 MiB is the standard slice size. Smaller = more cache hits but more metadata; larger = fewer hits but cheaper.
- **Where does the outboard live?** Stored alongside the data file. Shipped to peers via the manifest entry (a small base64 field) or fetched on-demand from a sibling endpoint — pick whichever keeps the manifest small.
- **Migration:** existing files without an outboard get one computed lazily on first read; OR a one-shot backfill on startup. Recommend startup backfill (small fleet, easy to run once).

## Out of scope

- Deduplication across the fleet by content hash (separate larger redesign — see RESEARCH.md §1).
- Replacing filename addressing with CID addressing.
- Resumable uploads from the client side (separate item).

## Acceptance criteria

- `GET /files/big.mp4` with `Range: bytes=10000000-19999999` returns the correct 10 MB slice (locally and via proxy).
- A bit-flipped file on a peer is detected on the next read and the read fails (rather than silently serving bad bytes).
- A second range request that overlaps a previous one is served from cache (verified via metrics).
- Video seeking works end-to-end in the UI for a >100 MB file held by a peer.

## References

- [iroh-blobs blob store design](https://www.iroh.computer/blog/blob-store-design-challenges)
- [n0-computer/iroh-blobs](https://github.com/n0-computer/iroh-blobs)
- [NGINX Smart Byte-Range Caching](https://blog.nginx.org/blog/smart-efficient-byte-range-caching-nginx)
- [The Impossibility of Perfectly Caching HTTP Range Requests](https://kevincox.ca/2021/06/04/http-range-caching/)
- [BLAKE3 provable data possession discussion](https://github.com/BLAKE3-team/BLAKE3/issues/146)
