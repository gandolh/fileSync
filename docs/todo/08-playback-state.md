# 08 — Playback state on the viewer's node (not the content node)

**Status:** proposed
**Priority:** P1 (federation pivot — affects schema, ship before public beta)
**Effort estimate:** 1–2 weeks
**Depends on:** [04-keypair-identity.md](04-keypair-identity.md), [09-catalog-sync-crdt.md](09-catalog-sync-crdt.md)
**Related research:** [RESEARCH-FEDERATION.md §E](../RESEARCH-FEDERATION.md#e-media-specific-concerns)

## Problem

Plex stores per-user playback state (resume position, watch history, ratings)
on the **content server**. Consequences:

- The library owner learns what each friend is watching, when, and for how long. **Privacy leak.**
- A user's watch history is tied to a specific server; migrating libraries loses history.
- Cross-friend "I watched this on Bob's server, now I'm continuing on Carol's" is impossible.

Plex tolerates this because of their central-account model. We have no such
constraint, so we can fix it architecturally.

## Proposal

**Playback state belongs to the viewer, not to the content host.** Each
user's node stores their own watch history, resume positions, ratings, and
preferences. Content nodes serve bytes; they never see who-watched-what.

### State model

The viewer's node maintains:

```
~/.fileSync/state/playback.db
{
  "items": {
    "<content_hash>": {
      "title":        "…",                        # denormalized from catalog at view time
      "resume_pos":   1342.5,                     # seconds
      "duration":     5400,
      "last_watched": "2026-05-22T18:00:00Z",
      "watch_count":  2,
      "rating":       4,
      "tags":         ["liked"],
      "source":       "alice"                     # which friend's library; informational only
    },
    …
  },
  "version":          42                          # for sync between user's own devices
}
```

Key insight: **state is keyed by `content_hash`**, not `(server, filename)`.
This means if Bob has the same movie on two friends' libraries, his resume
position is shared because it's the same content.

### Two sync layers

1. **Within one user's devices** (laptop + home server): use a private channel signed by the user's root pubkey. CRDT (LWW-Register keyed by `(content_hash, device)`) for conflict-free merge. This is the easy case — one principal, multiple devices.

2. **Between user's nodes (zero-knowledge to content host):** the content host *never sees* playback state. Period. Achieved by:
   - Player makes the streaming request with the content cap.
   - Player reports state **only** to the viewer's own node, not the host.
   - The content node's logs reflect "Bob streamed bytes X to Y of file F" — useful for billing/quota — but never "Bob is 30 minutes into Movie M."

### Player integration

- Web UI: state writes go to loopback `/playback/state` on the viewer's node.
- External players (VLC, Infuse, Jellyfin clients): expose a small Jellyfin-compatible API endpoint on the viewer's node that brokers requests to the content host while keeping state local.

## Scope of work

- [ ] `playback-state` module: SQLite + LWW-Register per device.
- [ ] `/playback/state` API (loopback only): get/set resume position, rating, etc.
- [ ] CRDT sync to user's other devices via the user's own private channel.
- [ ] Web UI: integrate with video player to emit progress events.
- [ ] **Do not** ship a "viewer watch state" feature to the content host. Make this an architectural invariant — add a lint / test that fails if a route on the peer-facing port touches the playback store.
- [ ] Optional: a Jellyfin-compatible playback API shim for external clients (deferred unless users ask).

## Design choices to confirm

- **What about parental controls / family accounts on one node?** A single user's node can host multiple "profiles" (each with their own playback store), but each profile has its own keypair. Same security model.
- **Cross-device device-count limits?** Should be enforceable by attenuated caps from [06](06-capability-tokens.md), but conceptually independent.
- **Should the content host see "Bob has watched this" aggregates?** No — explicitly out by design. If a content owner wants viewing analytics on their own watching, they have their own state store.
- **Sync conflict policy:** simultaneous resume positions from two devices → LWW by wall clock per `(content_hash, device)`. Edge case is fine — the user just rewinds if the wrong one wins.

## Out of scope

- Cross-friend collaborative features ("Bob watched this, recommends to Alice") — different model, deferred.
- Server-side aggregate analytics for the library owner. Explicitly rejected.
- Importing playback state from Plex / Jellyfin. Nice-to-have, separate item.

## Acceptance criteria

- Resume position on a movie streamed from a friend works correctly across reloads on the viewer's web UI.
- Bob can stream Alice's library, and Alice's node logs show **no** playback-position records.
- Bob's laptop and Bob's phone converge on resume position via his own device sync within 5 seconds.
- A test enforces: no playback-state import or endpoint reachable on the peer-facing port.

## References

- [Plex playback / resume model](https://support.plex.tv/articles/200250377-transcoding-media/) (for contrast)
- [HelloInterview: video resume sync design](https://www.hellointerview.com/community/questions/video-resume-sync/cm7c7v8ns0000356v3yg7jevs)
- [CRDT LWW-Register](https://crdt.tech/)
