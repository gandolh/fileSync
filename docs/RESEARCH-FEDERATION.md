# fileSync — Federation Research (Plex-for-trusted-friends)

This is a second research pass framed around a different question than
[RESEARCH.md](RESEARCH.md):

> **Each user runs their own server. The "fleet" is a small federation of
> people who know each other and have verified each other's identity
> out-of-band. Friends share libraries with friends.**

The first pass treated fileSync as a single operator's mesh. This pass
treats each *person* as the unit of administration, and the network as a
small federation of 5–50 trusted persons. The two directions are compatible
— a person can still run multiple nodes themselves — but the trust,
identity, and access-control story is fundamentally different.

See also: [todo/](todo/) for concrete action items.

---

## A. What Plex / Jellyfin / Emby actually do for sharing

| System | Sharing model | Critical path |
| --- | --- | --- |
| **Plex** | "Share library with email address." All identity flows through plex.tv. | [plex.tv](https://support.plex.tv/articles/201105738-creating-and-managing-server-shares/) is the directory; the server checks in. Remote streams default to a [2 Mbps relay](https://support.plex.tv/articles/216766168-accessing-a-server-through-relay/) hosted by Plex. plex.tv down → friends locked out. |
| **Jellyfin** | No central account. Each instance is an island. | [Federation is a long-standing feature request](https://features.jellyfin.org/posts/184/federated-servers); only community hacks exist ([JellyFederationPlugin](https://github.com/Angablade/JellyfinFederationPlugin), [Jellyswarrm](https://github.com/LLukas22/Jellyswarrm)). |
| **Emby** | Closed-source Plex clone; same central-account dependency. | — |

**Common user complaint:** ["All my friends lost access"](https://forums.plex.tv/t/all-my-friends-lost-access-to-the-plex-server/930622) because plex.tv auth flow broke — even though every server in the chain was online. This is the single anti-pattern to design out: **identity must not have a central failure point**.

**What to steal:** Plex's UX of "share by email" — but bind to a public key, not a centrally-resolved account.

---

## B. Federated identity for small social graphs

| System | Reference | Idea worth borrowing | Cost |
| --- | --- | --- | --- |
| **ATProto / Bluesky** | [Advanced guide](https://docs.bsky.app/docs/advanced-guides/atproto) | DID document with two Ed25519 keys: signing (held by server) + recovery (held by user, offline). Identity is portable across servers. | DID resolution infrastructure is non-trivial. |
| **Matrix** | [Server-Server API](https://spec.matrix.org/v1.16/server-server-api/) | Every event carries signature + hash; servers verify against published keys at `/_matrix/key/v2/server`. Notary model corroborates keys without a CA. | Heavy protocol; full Matrix homeserver is overkill. |
| **Nostr** | [How it works](https://nostr.co.uk/learn/how-nostr-works/) | Pubkey = identity. Generate a keypair, you exist. Relays cannot forge events. Implement a verifier in an afternoon. | Relay selection / spam are externalized to users. |
| **ActivityPub** | [HTTP Signatures](https://swicg.github.io/activitypub-http-signature/), [WebFinger+AP](https://www.w3.org/community/reports/socialcg/CG-FINAL-apwf-20240608/) | WebFinger maps `alice@host` → actor doc. HTTP Signatures (RFC 9421) sign every server-to-server request. | Coarse trust granularity (instance blocklists). |
| **Veilid** | [EFF intro](https://www.eff.org/el/deeplinks/2023/12/meet-spritely-and-veilid), [How it works](https://veilid.com/how-it-works/) | "Social-distance" routed framework — explicitly designed around friend graphs. | Young (2023+); ecosystem is sparse. |

**Takeaway:** The base primitive is **a per-user Ed25519 keypair as identity**. Nostr proves this is enough; ATProto shows how to make it portable. WebFinger is the layer that turns `64-char-hex` into `alice@her-media-box.home` for human use.

---

## C. Friend-of-friend / web-of-trust / capability-based access

| System | Reference | Idea worth borrowing | Cost |
| --- | --- | --- | --- |
| **PGP WoT (DEAD END)** | [Why it failed](https://medium.com/@bblfish/what-are-the-failings-of-pgp-web-of-trust-958e1f62e5b7), [WoT is dead](https://inversegravity.net/2019/web-of-trust-dead/) | Cautionary tale: public keyservers became a DoS vector, binary trust semantics, social-ceremony UX. | Don't replicate. |
| **Secure Scuttlebutt** | [ACM paper](https://dl.acm.org/doi/10.1145/3428662.3428794), [Scalable SSB](https://github.com/dominictarr/scalable-secure-scuttlebutt/blob/master/paper.md) | **Follow graph = replication graph.** You only sync feeds you (transitively) follow → natural spam gate. | Full-feed replication (all-or-nothing); sync lag for offline peers can be days. |
| **UCAN** | [Intro](https://blog.web3.storage/posts/intro-to-ucan), [Fission guide](https://fission.codes/ecosystem/ucan/) | JWT + capability + delegation chain. Verifiable offline against root pubkey. Re-delegation without contacting issuer. | Capability strings are less expressive than full Datalog. |
| **Biscuit tokens** | [Design doc](https://github.com/eclipse-biscuit/biscuit/blob/master/DESIGN.md), [biscuitsec.org](https://www.biscuitsec.org/) | Ed25519-signed block chain with embedded Datalog facts: "alice can read genre=Action, expires 2027-01-01" — verifiable against root key alone. | Datalog learning curve. |
| **Tahoe-LAFS caps** | [Architecture](https://tahoe-lafs.readthedocs.io/en/latest/architecture.html) | Capability URI = permission. Knowing the URI is the auth. Share over any channel. | Not revocable without deleting the file. |

**Takeaway:** Capability tokens (Biscuit or UCAN) > ACLs. Offline-verifiable, attenuable, expirable. **Avoid transitive trust** — it's where PGP and naive SSB break. Each friend edge is direct; no friend-of-a-friend implicit access.

---

## D. Discovery + connectivity between residential / NAT'd peers

| System | Reference | Idea worth borrowing | Cost |
| --- | --- | --- | --- |
| **Tailscale / WireGuard** | [How NAT traversal works](https://tailscale.com/blog/how-nat-traversal-works), [How Tailscale works](https://tailscale.com/blog/how-tailscale-works) | Coordination server distributes only public keys + endpoint hints. Private keys never leave devices. ~90% direct hole-punch, DERP relay for the rest. | Tailscale's coordinator is closed-source; use [Headscale](https://github.com/juanfont/headscale) if you self-host. |
| **libp2p** | [FOSDEM 2023 hole-punching data](https://archive.fosdem.org/2023/schedule/event/network_hole_punching_in_the_wild/attachments/slides/5874/export/events/attachments/network_hole_punching_in_the_wild/slides/5874/2023_fosdem_nat_hole_punching.pdf) | Pure DHT model. DCUtR hole-punch ~70% success in measured data (6.25M attempts, 2022). | The 30% miss rate is fatal for a media app — must always have a relay path. |
| **Iroh** | [Comparing iroh and libp2p](https://www.iroh.computer/blog/comparing-iroh-and-libp2p), [iroh-docs](https://github.com/n0-computer/iroh-docs) | "Accept a little centralization for reliability." Ticket format = pubkey + relay hint + direct candidates. Higher direct-connect rates than libp2p. | Rust-native; need bindings or hand-port. |
| **Magic Wormhole** | [Docs](https://magic-wormhole.readthedocs.io/) | PAKE (SPAKE2) over a short human code (`7-purple-dolphin`). Perfect for one-shot key exchange between two known people. | Rendezvous server needed (small, dumb). |

**Takeaway:** **Design for relay-first, upgrade-to-direct opportunistically.** Residential ISPs + CGNAT make pure P2P unreliable. A tiny self-hostable signaling server (Headscale-style) + DERP-style relay handles both bootstrap and fallback. Magic Wormhole / Iroh tickets are the right "add a friend" primitive — far better UX than copy-pasting a hex pubkey.

---

## E. Media-specific concerns

| Concern | Plex's approach | What a P2P design should do |
| --- | --- | --- |
| **Transcoding** | Always source-side ([Plex transcoding](https://support.plex.tv/articles/200250377-transcoding-media/)). Host CPU bottleneck. | Direct-play-first (most modern clients handle H.264/H.265). Source-side transcode only as fallback. **Never assume a friend's node has spare CPU.** |
| **Metadata** | Each server hits TMDb/TVDb independently. Rate-limit risk. | Cache + replicate metadata across friend graph keyed by content hash. iroh-docs-style CRDT sync works directly. |
| **Playback state** | Stored on the content node, per-user. Privacy leak: host knows what you watch. | **State stays on the viewer's node, not the content node.** Cleaner privacy; cleaner separation of concerns. |
| **Subtitles** | OpenSubtitles plugin. External dependency. | Sidecar `.srt` files replicate with the media, no external dependency. |
| **Resume / sync across viewer's own devices** | Plex stores it. | A single user's own devices sync via a private channel under one keypair — separate, simpler problem. |

**Takeaway:** A few of Plex's pain points are *architectural*, not implementation choices. Putting playback state on the viewer's node instead of the content node is a strictly better design that Plex can't adopt because of their central account model.

---

## F. Recent work (2022–2026)

| System | Reference | Status |
| --- | --- | --- |
| **Solid (Berners-Lee)** | [Protocol](https://solidproject.org/TR/protocol), [WAC](https://solidproject.org/TR/wac) | Mental model is right (POD = your data on your server, WAC gates per-resource access). RDF/Linked-Data machinery is heavier than fileSync needs. |
| **iroh-docs + iroh-blobs** | [iroh-docs](https://github.com/n0-computer/iroh-docs), [iroh-blobs design](https://www.iroh.computer/blog/blob-store-design-challenges) | Closest thing to a ready-made P2P-Plex catalog bus. Metadata sync via range-based set reconciliation; blob transfer via BLAKE3-verified streaming. |
| **Grassroots Social Networking (arXiv 2306.13941)** | [Paper](https://arxiv.org/html/2306.13941v4) | 2023/24 academic. Serverless P2P social graph. Trust anchor = the graph itself. Deployment maturity ≈ 0. |

---

## What this means for fileSync, specifically

These are the design implications of pivoting from "single-operator mesh" to "federation of trusted persons." Each becomes an action item in [todo/](todo/).

### 1. Identity is a per-user Ed25519 keypair, generated locally on first run

No accounts. No central directory. The Nostr / ATProto / Veilid lesson: a keypair is enough. Bind a human-friendly handle via WebFinger (`alice@her-media-box.home`) for usability.

### 2. "Add friend" = Magic Wormhole / Iroh-ticket exchange

Out-of-band verified — Alice reads Bob a short code over Signal or in person. Wormhole exchanges public keys + connection hints. This is PGP's security model with none of PGP's UX problems, because there is no keyserver.

### 3. Authorization = Biscuit (or UCAN) capability tokens, not ACLs

Alice issues Bob a Biscuit: "read library, items tagged genre=Action, expires 2027-01-01." Bob's node verifies offline against Alice's root pubkey. Bob can attenuate and re-delegate to *his* devices. Replaces the current fleet-wide shared bearer entirely.

### 4. Connectivity: relay-first, direct-upgrade opportunistically

Run (or rely on) a Headscale-style minimal coordinator that learns only public keys + endpoint hints. DERP-style relay for fallback. Direct WireGuard / QUIC when reachable. Tailscale's published ~90% direct + 10% relay numbers are the realistic target.

### 5. Playback state lives on the viewer's node, never the content node

Each user's resume positions, watch history, and ratings are on their own server. Bob streams from Alice's content node, but Alice never learns what episode Bob is on. This is a strictly cleaner privacy story than Plex.

### 6. Catalog is a CRDT keyed by content hash, replicated across the friend graph

iroh-docs-style range-based set reconciliation; metadata (posters, descriptions, subtitles paths) syncs first, blob streaming on demand. One node fetches TMDb metadata, the whole friend graph benefits. Composes cleanly with [todo/01-delta-gossip.md](todo/01-delta-gossip.md).

### 7. No transitive trust — friend-of-a-friend is **not** implicit access

This is the line that separates "modern WoT" from "PGP WoT." Every friend edge is a deliberate, out-of-band-verified, manually-issued capability. Visibility into who-knows-whom is fine; default access is not.

### 8. Drop the shared bearer token entirely

The shared bearer was correct for a single-operator fleet. It is wrong for a federation — it gives every friend the same key as every other friend, with no scoping, expiry, or revocation. Replace with per-edge Biscuit tokens (see #3).

---

## What we deliberately do NOT pursue

- **PGP-style public web of trust** — historical failure modes are well-documented; we have no reason to repeat them.
- **Plex-style central directory** — the single-point-of-failure pattern is exactly what we're designing away from.
- **Pure libp2p / pure-P2P with no relay** — 30% NAT failure rate is unacceptable for a media app.
- **ACL-based authorization** — capability tokens are strictly better for offline verification and delegation.
- **Putting playback state on the content node** — Plex does this for legacy account-model reasons; we have no such constraint.
- **Federating with strangers** — the trust model is explicitly "people I have verified out-of-band." No public-instance discovery.

---

## All sources (this pass)

- [Plex: Managing Library Access](https://support.plex.tv/articles/201105738-creating-and-managing-server-shares/)
- [Plex: Accessing a Server through Relay](https://support.plex.tv/articles/216766168-accessing-a-server-through-relay/)
- [Plex forum: friends lost access](https://forums.plex.tv/t/all-my-friends-lost-access-to-the-plex-server/930622)
- [Plex vs Jellyfin](https://datahoarder.io/plex-vs-jellyfin/)
- [Jellyfin Federation feature request](https://features.jellyfin.org/posts/184/federated-servers)
- [JellyfinFederationPlugin](https://github.com/Angablade/JellyfinFederationPlugin)
- [Jellyswarrm](https://github.com/LLukas22/Jellyswarrm)
- [Bluesky / ATProto guide](https://docs.bsky.app/docs/advanced-guides/atproto)
- [ATProto 2024 retrospective](https://docs.bsky.app/blog/looking-back-2024)
- [Matrix Server-Server API](https://spec.matrix.org/v1.16/server-server-api/)
- [ActivityPub HTTP Signatures](https://swicg.github.io/activitypub-http-signature/)
- [ActivityPub + WebFinger](https://www.w3.org/community/reports/socialcg/CG-FINAL-apwf-20240608/)
- [How Nostr works](https://nostr.co.uk/learn/how-nostr-works/)
- [PGP WoT failings](https://medium.com/@bblfish/what-are-the-failings-of-pgp-web-of-trust-958e1f62e5b7)
- [Web of Trust is dead](https://inversegravity.net/2019/web-of-trust-dead/)
- [SSB gossiping with append-only logs](https://dl.acm.org/doi/10.1145/3428662.3428794)
- [Scalable Secure Scuttlebutt](https://github.com/dominictarr/scalable-secure-scuttlebutt/blob/master/paper.md)
- [UCAN intro](https://blog.web3.storage/posts/intro-to-ucan)
- [UCAN guide (Fission)](https://fission.codes/ecosystem/ucan/)
- [Biscuit design](https://github.com/eclipse-biscuit/biscuit/blob/master/DESIGN.md)
- [biscuitsec.org](https://www.biscuitsec.org/)
- [Tahoe-LAFS architecture](https://tahoe-lafs.readthedocs.io/en/latest/architecture.html)
- [Tailscale: How NAT traversal works](https://tailscale.com/blog/how-nat-traversal-works)
- [Tailscale: How it works](https://tailscale.com/blog/how-tailscale-works)
- [Headscale](https://github.com/juanfont/headscale)
- [FOSDEM 2023 hole-punching study](https://archive.fosdem.org/2023/schedule/event/network_hole_punching_in_the_wild/attachments/slides/5874/export/events/attachments/network_hole_punching_in_the_wild/slides/5874/2023_fosdem_nat_hole_punching.pdf)
- [Comparing iroh and libp2p](https://www.iroh.computer/blog/comparing-iroh-and-libp2p)
- [iroh-docs](https://github.com/n0-computer/iroh-docs)
- [iroh-docs protocol docs](https://docs.iroh.computer/protocols/documents)
- [Magic Wormhole](https://magic-wormhole.readthedocs.io/)
- [Plex transcoding](https://support.plex.tv/articles/200250377-transcoding-media/)
- [UnicornTranscoder](https://github.com/UnicornTranscoder/UnicornTranscoder)
- [Plex metadata agents](https://support.plex.tv/articles/200241558-agents/)
- [Solid protocol](https://solidproject.org/TR/protocol)
- [Solid WAC](https://solidproject.org/TR/wac)
- [Solid on Wikipedia](https://en.wikipedia.org/wiki/Solid_(web_decentralization_project))
- [Grassroots Social Networking (arXiv 2306.13941)](https://arxiv.org/html/2306.13941v4)
- [EFF: Spritely and Veilid](https://www.eff.org/el/deeplinks/2023/12/meet-spritely-and-veilid)
- [Veilid: How it works](https://veilid.com/how-it-works/)
- [Video resume sync design](https://www.hellointerview.com/community/questions/video-resume-sync/cm7c7v8ns0000356v3yg7jevs)
