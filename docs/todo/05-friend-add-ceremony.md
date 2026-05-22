# 05 — "Add friend" ceremony (wormhole-style key exchange)

**Status:** proposed
**Priority:** P0 (federation pivot)
**Effort estimate:** 1–2 weeks
**Depends on:** [04-keypair-identity.md](04-keypair-identity.md)
**Related research:** [RESEARCH-FEDERATION.md §B + §D](../RESEARCH-FEDERATION.md#b-federated-identity-for-small-social-graphs)

## Problem

A federation needs a way for Alice and Bob — who know each other in real life
— to exchange their public keys and connection hints. The constraints:

- Verified out-of-band (so a network attacker cannot impersonate either side).
- Zero account creation, zero central server lookup.
- UX that is realistic for non-technical users — better than "copy-paste this 64-character hex string."
- Symmetric: both sides get each other's pubkey in one exchange.

## Proposal

Use a **PAKE-based short-code exchange** (the Magic Wormhole pattern), against
a small rendezvous server that we either self-host or share with the federation
community. Wrap the pubkey + endpoint hints into a single artifact, exchanged
in one round.

### The flow

1. Alice clicks "Add a friend" in her UI.
2. Her node generates a one-time short code: `7-purple-dolphin` (BIP-39-style, 3 words).
3. Alice reads the code to Bob over a verified channel (Signal, phone, in person).
4. Bob enters the code in his UI's "Accept invite" field.
5. Both nodes connect to the rendezvous server, run SPAKE2 with the code as the password, and establish an authenticated encrypted channel.
6. Over that channel they exchange:
   - Each other's **pubkey + fingerprint**
   - Each other's **connection hints** (relay address, candidate direct endpoints)
   - An optional **initial Biscuit capability** (see [06](06-capability-tokens.md))
7. Each UI shows the friend's fingerprint with **"verify with your friend by voice"** — the canonical security ceremony.
8. The exchange completes; both nodes write the friend record to disk.

### Friend record format

```
~/.fileSync/friends/<pubkey-hash>.json
{
  "pubkey":       "z6Mk…",
  "fingerprint":  "alpha-bravo-charlie-delta-echo",
  "handle":       "alice",                      # local nickname, not authoritative
  "added_at":     "2026-05-22T12:00:00Z",
  "verified":     true,                         # user confirmed fingerprint matches
  "endpoints":    [{ "type": "relay", "url": "…" }, …],
  "their_caps":   ["…biscuit token from them to me…"],
  "my_caps":      ["…biscuit token from me to them…"]
}
```

## Scope of work

- [ ] SPAKE2 implementation (use a vetted library — likely `@noble/curves` + a thin SPAKE2 wrapper, or port `magic-wormhole`'s state machine).
- [ ] Rendezvous server: tiny WS-relay (~200 LoC) that pairs clients by short code. Self-hostable; default to our own.
- [ ] BIP-39-style code generator (3 words, ~30 bits of entropy — enough given one-shot and rate-limited).
- [ ] UI: "Add friend" + "Accept invite" flows. Both show the resulting fingerprint and require explicit "I verified this by voice" confirmation.
- [ ] Friend record persistence + management UI (list, view, remove).
- [ ] On the wormhole channel, exchange pubkey + endpoint hints + initial capability tokens.
- [ ] Handle code expiry (5 min default), wrong code → secure failure (PAKE makes brute-force online-only and rate-limit-able).

## Design choices to confirm

- **Rendezvous server: self-hosted vs reuse Magic Wormhole's?** Self-hosting gives full control but is one more thing to operate. Probably ship with a default to our hosted instance + an env var to override.
- **Code format:** 3 BIP-39 words, separated by `-`. Optionally include a 1-digit channel number prefix (`7-…`) for parallelism on a busy server.
- **What if the user mis-types the code?** SPAKE2 surfaces this as a clean "connection failed" — not "data leaked." This is exactly why PAKE > a raw key-exchange.
- **QR code variant:** for in-person pairing, render the code as a QR. Speeds up the ceremony when both phones are present.
- **Should we offer an "import friend by file" alternative?** Yes — for sneakernet / async / no-rendezvous-server cases. Signed payload exchanged via any channel (email, USB), but the security devolves to "trust the channel," which is fine for technical users.

## Out of scope

- Group invites (everyone adds everyone individually for now; transitive trust is deliberately not implicit).
- Recovery: "I lost my keypair" requires using the recovery key from [04](04-keypair-identity.md), separate flow.
- Discovery beyond explicit invites (no public listing).

## Acceptance criteria

- Alice and Bob can complete the add-friend ceremony end-to-end in under 60 seconds, including the voice-verify step.
- An attacker on the rendezvous server cannot recover either pubkey or impersonate either side (PAKE property).
- After the ceremony, both nodes have a friend record with the correct pubkey, fingerprint, and initial endpoint hints.
- Expired / wrong codes fail cleanly with no data leak.
- A user can review and remove friends from the UI.

## References

- [Magic Wormhole documentation](https://magic-wormhole.readthedocs.io/)
- [SPAKE2 — Ed25519-based PAKE (Noble curves)](https://github.com/paulmillr/noble-curves)
- [Iroh tickets — alternative compact exchange format](https://www.iroh.computer/blog/comparing-iroh-and-libp2p)
- [BIP-39 wordlist](https://github.com/bitcoin/bips/blob/master/bip-0039/english.txt)
