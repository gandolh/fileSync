# 04 — Per-user Ed25519 keypair as identity

**Status:** proposed
**Priority:** P0 (foundation for the federation pivot)
**Effort estimate:** 1 week
**Related research:** [RESEARCH-FEDERATION.md §B](../RESEARCH-FEDERATION.md#b-federated-identity-for-small-social-graphs)

## Problem

Today identity is fleet-wide: every node holds the same shared bearer token and
a CA-signed cert. There is no notion of "this user" — only "this node in the
fleet." When fileSync becomes a federation of trusted friends, we need:

- A stable identity that is **not** tied to any particular server / IP / domain.
- An identity that can be **verified out-of-band** by a friend (so they know they're connecting to *you* and not an impostor).
- An identity that does **not** require a central directory (Plex's failure mode).

## Proposal

Each user generates an **Ed25519 keypair** on first run. The public key is
their identity. No account, no email, no central registration.

### Key material

```
~/.fileSync/identity/
├── owner.key          # Ed25519 private signing key (chmod 600)
├── owner.pub          # Ed25519 public key (the user's identity)
└── owner.recovery     # offline recovery key, optional (printed once, user prints/stores)
```

The pubkey is shown to the user as:
- A **multibase-encoded string** (`z6Mk…` Ed25519 multikey) for machine use.
- A **5-word BIP-39-style fingerprint** for human verification ("voice over the phone": *"alpha-bravo-charlie-delta-echo"*).
- An optional **WebFinger handle** (`alice@her-media-box.home`) once the user wires up a domain.

### Two-key model (borrowed from ATProto)

- **Signing key** — held by the running node, signs all outbound capabilities / messages.
- **Recovery key** — generated once, never stored on disk by default. Used to rotate the signing key if the node is compromised. Printable QR or BIP-39 mnemonic.

### What the keypair authorises

- **Signing capability tokens** issued to friends (see [06-capability-tokens.md](06-capability-tokens.md)).
- **Signing the user's own catalog** (so friends can verify the catalog wasn't tampered with by a relay).
- **Identifying the user across nodes** — a user with multiple machines (laptop + home server) signs each device with the same root key.

## Scope of work

- [ ] Add `identity/` module: generate, load, persist Ed25519 keypair on first run.
- [ ] Expose pubkey via `/identity` endpoint (loopback only initially).
- [ ] Implement the 5-word fingerprint formatting.
- [ ] Generate recovery key on first run; UI shows it once with explicit "write this down" warning.
- [ ] Expose pubkey + fingerprint in the UI's settings page.
- [ ] Add a `device-key` per machine that's countersigned by the recovery key — supports multi-device users without exposing the root key on every box.
- [ ] Backwards-compat note: existing nodes upgrading get a new keypair on next boot; old mTLS certs continue to work for now (handled in [07-relay-connectivity.md](07-relay-connectivity.md)).

## Design choices to confirm

- **Library:** Node has built-in `crypto.generateKeyPairSync('ed25519', …)`. No external dep needed for the key itself. For multibase encoding, prefer a tiny dependency over hand-rolling.
- **Where does the recovery key live?** Default: printed to console + UI once, then forgotten. Optional: encrypted-at-rest backup behind a passphrase.
- **WebFinger handle:** optional, not required to operate. Most users will live by pubkey + fingerprint alone.
- **Per-device vs per-user keys:** the recovery key is per-user; the device key (which actually signs runtime traffic) is per-device. Compromised device → revoke device key with recovery key, no need to tell every friend a new pubkey.

## Out of scope

- DID resolution infrastructure (we are not building ATProto).
- Public key servers (deliberately rejected — see RESEARCH-FEDERATION.md §C).
- Federating with strangers / public discovery.

## Acceptance criteria

- First-run wizard generates keypair, displays fingerprint + recovery key, persists them.
- `/identity` returns the pubkey + fingerprint.
- A user with two machines can pair them under one identity by countersigning the second device's key.
- Recovery flow: with the recovery key, a user can rotate the signing key and publish the new device key.

## References

- [Bluesky / ATProto two-key DID model](https://docs.bsky.app/docs/advanced-guides/atproto)
- [Nostr keypair-as-identity model](https://nostr.co.uk/learn/how-nostr-works/)
- [Multibase / multikey spec](https://www.w3.org/TR/controller-document/#multikey)
