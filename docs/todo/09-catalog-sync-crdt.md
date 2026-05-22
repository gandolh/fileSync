# 09 — Catalog + metadata sync as a CRDT across the friend graph

**Status:** proposed
**Priority:** P1 (federation pivot)
**Effort estimate:** 2–4 weeks
**Depends on:** [04-keypair-identity.md](04-keypair-identity.md), [06-capability-tokens.md](06-capability-tokens.md), composes with [01-delta-gossip.md](01-delta-gossip.md), uses [03-blake3-ranges.md](03-blake3-ranges.md)
**Related research:** [RESEARCH-FEDERATION.md §E + §F](../RESEARCH-FEDERATION.md#e-media-specific-concerns)

## Problem

A media library needs more than a `(filename → location)` index:

- **Metadata** — title, poster, year, director, genre, summary, runtime.
- **Relationships** — TV series → seasons → episodes, multi-part movies.
- **External enrichment** — TMDb / TVDb / MusicBrainz IDs and the data they resolve to.
- **Subtitles** — file paths or embedded tracks.
- **Tags** — user-added classifications used by capability tokens ("read items WHERE tag = 'Movies'").

Today there is no metadata in fileSync's manifest. Even worse, if we naively
put metadata in each owner's catalog and let every friend hit TMDb
independently, we hit rate limits and duplicate work.

## Proposal

Model the catalog as a **CRDT keyed by content hash**, sync deltas via the
existing gossip channel ([01](01-delta-gossip.md)), so metadata enrichment is
collaborative across the friend graph.

### Content addressing as the primary key

```
catalog[<content_hash>] = {
  "title":          "…",
  "year":           2024,
  "poster_url":     "blob:<content_hash_of_poster>",   # poster is itself a blob
  "tmdb_id":        12345,
  "duration_s":     5400,
  "subtitles":      [{ "lang": "en", "blob": "<hash>" }],
  "tags":           ["Movies", "Action"],
  "owner":          "alice.pubkey",                    # who hosts the actual file
  "size_bytes":     2_100_000_000,
  "added_at":       "…"
}
```

`content_hash` is the BLAKE3 root from [03](03-blake3-ranges.md). The catalog
entry is decoupled from the file's filesystem path — two friends with the
same movie (by hash) share one catalog entry.

### CRDT semantics

- Each `catalog[hash]` is a **LWW-Map** with per-field LWW timestamps and a per-field author pubkey.
- Authority rules:
  - **Owner-only fields** (`size_bytes`, `owner`): only the owning node can write. Verified by signature.
  - **Anyone-with-cap fields** (`title`, `tags`, `tmdb_id`, `poster_url`): any friend with a write-cap on the entry can update. Conflict → LWW by wall clock with content-hash tiebreak.
  - **Per-viewer fields** (`my_tags`, `my_rating`): live in playback state ([08](08-playback-state.md)), not the shared catalog.

### Metadata enrichment as collaborative work

When Alice imports a new file:
1. Her node computes the content hash, creates a stub catalog entry.
2. Her node queries TMDb for metadata, signs the result, gossips it.
3. Bob's node receives the gossip, validates the signature, merges into its catalog.
4. If Carol later imports the same movie (same hash), Bob's gossip wins — no TMDb call needed.

### Catalog visibility = capability

A catalog entry is only visible to friends whose capability grants `read` on
its `(owner, tags)`. Filtering happens at gossip time: Alice's node refuses
to ship a catalog entry to Bob unless Bob's cap covers it. This is
"follow-graph-as-replication-graph" from SSB, refined with cap-scoping.

## Scope of work

### Schema
- [ ] Define the catalog entry schema (versioned, forward-compatible).
- [ ] Define the LWW-Map CRDT with per-field author + timestamp.
- [ ] Migration tool from current manifest → versioned catalog.

### Sync
- [ ] Extend gossip from [01](01-delta-gossip.md) to ship catalog deltas, not just manifest entries.
- [ ] Apply cap-based visibility filter at send time.
- [ ] Verify signatures on receive; reject entries whose author lacks authority.

### Enrichment
- [ ] TMDb / TVDb / MusicBrainz client (pluggable; one default).
- [ ] Background enrichment job: walks new entries, fetches metadata, signs, gossips.
- [ ] Rate-limit + back off; respect API ToS.
- [ ] **Skip enrichment for entries already enriched by any friend** — the whole point.

### Storage
- [ ] SQLite for the catalog (fast queries, easy migrations).
- [ ] Blob store for posters / subtitle sidecars (keyed by their own content hash, served via the existing file path).

### UI
- [ ] Catalog browse UI: posters, metadata, filter by tag.
- [ ] "Edit metadata" UI: only available for entries the user has a write-cap on.
- [ ] Show provenance per field ("title set by alice 2 days ago") — useful for debugging conflicting metadata.

## Design choices to confirm

- **Hand-rolled CRDT vs library?** A LWW-Map is ~150 lines; libraries (`yjs`, `automerge`) bring real complexity. Recommend hand-rolled for the catalog and revisit if requirements grow.
- **iroh-docs as the sync layer?** Most direct fit, but adds a Rust dependency (see [07](07-relay-connectivity.md) for the broader iroh question). Keep as an option to evaluate during implementation.
- **What if Alice and Bob disagree about a movie's title?** LWW resolves it. The UI should make conflicts visible ("Bob set this title 1h ago, you set yours 30m ago"). If users want manual conflict resolution, that's a future feature.
- **Posters: separate blob or inline?** Separate blob. Catalogs stay small; posters travel via the same content-addressed blob mechanism as the media itself.

## Out of scope

- Federated search across multiple friends' libraries in one query — separable, builds on top of synced catalogs.
- ML-based metadata enrichment (auto-tagging, scene detection). Big rabbit hole.
- Importing existing Plex / Jellyfin metadata databases. Useful, separate item.

## Acceptance criteria

- Alice imports a new movie; metadata appears in Bob's catalog within one gossip tick.
- Carol imports the same movie (same content hash); her node does not call TMDb because Bob already provided the metadata.
- A field edited by Bob with a write-cap is accepted by Alice's node; an edit attempt by Mallory without a cap is rejected.
- Posters render in Bob's UI for movies hosted by Alice (poster blob fetched on demand).
- Catalog supports >10k entries with sub-100ms search latency on commodity hardware.

## References

- [iroh-docs range-based set reconciliation](https://github.com/n0-computer/iroh-docs)
- [iroh documents protocol](https://docs.iroh.computer/protocols/documents)
- [CRDT LWW-Map](https://crdt.tech/)
- [Plex agent / metadata model](https://support.plex.tv/articles/200241558-agents/) (for contrast)
- [SSB: follow graph as replication graph](https://github.com/dominictarr/scalable-secure-scuttlebutt/blob/master/paper.md)
