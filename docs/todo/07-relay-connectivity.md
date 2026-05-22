# 07 — Relay-first connectivity with direct upgrade

**Status:** proposed
**Priority:** P0 (federation pivot)
**Effort estimate:** 2–3 weeks
**Depends on:** [04-keypair-identity.md](04-keypair-identity.md)
**Related research:** [RESEARCH-FEDERATION.md §D](../RESEARCH-FEDERATION.md#d-discovery--connectivity-between-residential--natd-peers)

## Problem

Residential ISPs, CGNAT, mobile networks, and aggressive firewalls mean that
direct peer-to-peer connections between friends fail a non-trivial fraction
of the time:

- libp2p's measured hole-punch success rate in the wild is [~70%](https://archive.fosdem.org/2023/schedule/event/network_hole_punching_in_the_wild/attachments/slides/5874/export/events/attachments/network_hole_punching_in_the_wild/slides/5874/2023_fosdem_nat_hole_punching.pdf) — meaning ~30% of friend pairs cannot reach each other directly.
- Tailscale's reported success rate is ~90% direct + 10% relay — much better, but the 10% relay path is **essential**, not optional.

A media-sharing app cannot accept "sometimes the friend just doesn't load."
Relay must always be available; direct is a latency / cost optimization.

## Proposal

Adopt the **Tailscale architectural pattern** (without depending on Tailscale itself):

1. **Tiny coordination / signaling server** that learns only pubkeys + endpoint hints. Private data never passes through.
2. **DERP-style relay** that proxies authenticated, end-to-end-encrypted traffic when direct fails.
3. **Direct-upgrade** via STUN + ICE-like candidate exchange whenever both peers can punch through.

Default to "use the federation's relay"; allow self-hosting via [Headscale](https://github.com/juanfont/headscale) or a small custom relay if the user wants full control.

### Architecture

```
                    ┌─────────────────┐
                    │ Coordination /  │  (knows: friend pubkeys, endpoint hints)
                    │ Signaling       │  (does NOT see: traffic, content)
                    └─────────────────┘
                          ▲       ▲
                          │ TLS   │ TLS
                          │       │
   ┌──────────────────┐   │       │   ┌──────────────────┐
   │   Alice's node   │───┘       └───│   Bob's node     │
   │                  │                │                  │
   │   Friend list    │   ◀──────▶    │   Friend list    │
   │   + endpoint hints│ direct QUIC  │   + endpoint hints│
   │                  │   (~90%)      │                  │
   └──────────────────┘                └──────────────────┘
            │                                   │
            └────────────▶ DERP relay ◀─────────┘
                          (~10% fallback, E2E encrypted)
```

### Endpoint hints

A friend's endpoint hint is a small bundle published to the coordination server:

```json
{
  "pubkey":  "z6Mk…",
  "relays":  ["wss://relay-eu.fileSync.network/"],
  "direct":  [
    { "addr": "203.0.113.5:4567", "type": "stun" },
    { "addr": "[2001:db8::1]:4567", "type": "v6" }
  ],
  "updated_at": "…"
}
```

The signaling server is dumb: it accepts updates from `pubkey` (signed by the
matching private key) and serves them to authorized friends.

### Transport choice: QUIC

- Built-in TLS 1.3 + mTLS via raw public keys (RFC 7250) — no CA needed.
- 0-RTT for warm friends.
- UDP-based, so hole-punching works as for raw UDP.
- Cleanly multiplexes catalog sync streams + media streams.

### Direct-upgrade protocol

1. On connect, peers exchange ICE-like candidates over the relay channel.
2. Each side attempts direct UDP punch to each candidate.
3. First successful direct path wins; migrate the QUIC connection.
4. Fall back to relay if direct path drops.

## Scope of work

### Coordination server
- [ ] Tiny WS service: pubkey-authenticated updates, friend-list-scoped reads.
- [ ] Deploy a default instance + document self-hosting.

### DERP-style relay
- [ ] Authenticated WebSocket relay: server only routes encrypted payloads keyed by pubkey-pair.
- [ ] Bandwidth caps + abuse mitigations (rate limit, max concurrent streams per pair).
- [ ] Multi-region: at minimum one EU + one US relay.

### Node-side
- [ ] QUIC server + client using raw public keys (Node has `node:tls` ALPN + experimental raw-pubkey support; may need a Rust binding via `quinn` or `quiche` if Node's QUIC is too thin).
- [ ] Endpoint-hint publisher: signs and posts hints to coordination on boot + every N minutes.
- [ ] STUN client to learn public reflexive addresses.
- [ ] ICE-lite candidate gathering + punch loop.
- [ ] Connection migration: hand off active QUIC streams from relay to direct.

### Migration from mTLS+bearer
- [ ] mTLS continues to work for one release on a separate port (legacy mode).
- [ ] New connections default to QUIC + raw pubkey + capability tokens (from [06](06-capability-tokens.md)).

## Design choices to confirm

- **Build vs reuse?** A real option is to embed [iroh](https://github.com/n0-computer/iroh) (Rust, via N-API) — we get hole-punch, relay, ticket exchange, and BLAKE3 transport for free. Risk: Rust dependency in a Node project, bindings maintenance. Recommend prototyping both approaches before committing.
- **Headscale?** Useful as a known good design / reference implementation. Forking it adds operational complexity; reading its NAT-traversal code is cheap and informative.
- **Default relay hosting?** Either we host one (operational cost + responsibility) or rely on a friend-of-the-project. Spec it to be self-hostable in <30 minutes either way.
- **IPv6 first?** Yes — direct connections are far more likely on IPv6. Endpoint hints prefer v6.

## Out of scope

- Multi-hop routing (Veilid-style social-distance routing). Maybe later.
- Mobile push wake-up (so a phone-hosted friend can be reached when asleep). Big rabbit hole; defer.
- DDoS protection beyond per-pubkey rate limits.

## Acceptance criteria

- Two friends on residential CGNAT can complete a media stream via relay (no manual port forwarding).
- Two friends with at least one direct path migrate from relay to direct within 5 seconds of connection.
- Relay outage: peers automatically retry; existing direct connections are unaffected.
- The coordination server going down does **not** terminate established connections — only blocks new pairings.

## References

- [Tailscale: How NAT traversal works](https://tailscale.com/blog/how-nat-traversal-works)
- [Tailscale: How Tailscale works](https://tailscale.com/blog/how-tailscale-works)
- [Headscale (open-source Tailscale coordinator)](https://github.com/juanfont/headscale)
- [FOSDEM 2023 hole-punching study](https://archive.fosdem.org/2023/schedule/event/network_hole_punching_in_the_wild/attachments/slides/5874/export/events/attachments/network_hole_punching_in_the_wild/slides/5874/2023_fosdem_nat_hole_punching.pdf)
- [Iroh vs libp2p](https://www.iroh.computer/blog/comparing-iroh-and-libp2p)
- [QUIC raw public keys (RFC 7250)](https://datatracker.ietf.org/doc/html/rfc7250)
- [STUN (RFC 8489)](https://datatracker.ietf.org/doc/html/rfc8489)
