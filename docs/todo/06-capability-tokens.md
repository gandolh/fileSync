# 06 — Capability tokens (Biscuit or UCAN) instead of shared bearer

**Status:** proposed
**Priority:** P0 (federation pivot — biggest single auth change)
**Effort estimate:** 2–3 weeks
**Depends on:** [04-keypair-identity.md](04-keypair-identity.md), [05-friend-add-ceremony.md](05-friend-add-ceremony.md)
**Related research:** [RESEARCH-FEDERATION.md §C](../RESEARCH-FEDERATION.md#c-friend-of-friend--web-of-trust--capability-based-access)

## Problem

The current shared bearer token (see [DESIGN.md](../DESIGN.md)):

- **Fleet-wide** — same token for every participant. Cannot revoke per-friend.
- **No scoping** — token holder can read everything.
- **No expiry** — leaks live forever until rotation.
- **No delegation** — Alice cannot say "Bob's iPhone can have a read-only token derived from Bob's friend token."
- **Wrong abstraction for federation** — friends are individuals, not interchangeable members of a fleet.

## Proposal

Replace the shared bearer with **per-edge capability tokens** issued by the
library owner and verified offline by the receiving node. Recommend
**Biscuit** for its Datalog expressiveness; UCAN is the second choice if the
ecosystem fit is better. Either is strictly more powerful than ACLs.

### What a capability looks like

```
Alice's root pubkey ─signs─▶ Biscuit token for Bob:
  - audience:  bob.pubkey
  - resource:  library: alice
  - allowed:   read items WHERE tag IN ("Movies", "Music")
  - allowed:   stream items WHERE size_mb < 5000
  - denied:    write
  - expires:   2027-01-01T00:00:00Z

Bob ─attenuates─▶ derived token for his iPhone:
  - inherits all of the above
  - additionally: device = "iphone-bob-2025"
  - expires:   30 days from now
```

Bob's iPhone presents the chain to Alice's node. Alice's node verifies:
1. Each signature in the chain.
2. The chain roots at Alice's pubkey (her own root cap).
3. The cumulative policy (intersection of all blocks) permits the request.
4. Nothing in the chain has expired.

No network call to a third party. No ACL table. The policy travels with the token.

### What the policy language can express (Biscuit Datalog)

- **Resource scopes:** `library`, specific tags, specific content hashes.
- **Operation scopes:** `read`, `stream`, `write` (forbid by default).
- **Time bounds:** `expires`, optional `not_before`.
- **Quantitative limits:** `bytes_per_day`, `max_concurrent_streams`.
- **Device scoping:** `device_pubkey = X` so a leaked token from Bob's laptop doesn't grant access from Bob's other devices.
- **Revocation list ID:** optional `cap_id` so we can publish a short-lived deny-list (see §Revocation below).

### Three layers of tokens

1. **Root capability** — Alice's node signs this for itself on boot. Authority for the whole library.
2. **Friend capability** — Alice issues this once during the friend-add ceremony. Scoped: which library, what tags, what operations, expiry. Long-lived (months) but bounded.
3. **Device / session capability** — derived locally by the friend's node from their friend cap. Short-lived (hours/days). Each device gets its own.

## Scope of work

### Issuance
- [ ] Library: pick Biscuit (recommend) or UCAN.
- [ ] Implement root cap auto-generation on boot.
- [ ] Friend-cap issuance during add-friend ceremony — default policy (read + stream all, expires 1 year), editable in UI.
- [ ] Device-cap attenuation UI: per-device list, revoke / refresh buttons.

### Verification
- [ ] Auth middleware: replace bearer check with cap verification.
- [ ] Cache verification results per (cap_id, request_fingerprint) for the cap's TTL.
- [ ] Reject if root pubkey doesn't match a known friend OR doesn't match self.
- [ ] Surface auth failures clearly in logs (which friend, which scope was missing).

### Revocation
- [ ] **Short-cap-list (SCL)** — each friend publishes a small list of revoked `cap_id`s in their gossiped catalog. Verifiers consult their cached copy. Updates propagate at gossip speed (#01). This is the operational compromise: instant revocation is impossible without a central server, but ~1-tick revocation is good enough at fleet scale.
- [ ] On friend removal: revoke their cap by adding its `cap_id` to the SCL. Optionally also rotate root pubkey if compromise is suspected.

### Transport
- [ ] Caps travel as a header: `Authorization: Biscuit <base64-cap-chain>`.
- [ ] Caps are also embedded in WebSocket upgrade for streaming.

## Design choices to confirm

- **Biscuit vs UCAN?** Biscuit's Datalog is more expressive (good for "read genre=Action AND year>2020"); UCAN is simpler and has more JS ecosystem. Start with Biscuit if a maintained JS port exists; fall back to UCAN if the Biscuit-JS situation is too thin.
- **Cap size:** typically <1 KB per chain block, negligible.
- **Cap leak risk:** mitigate with short expiry + audience binding (`audience = bob.pubkey` means a leaked cap is useless without bob's signing key).
- **Backwards compatibility:** keep bearer auth supported as a feature flag for one release while the federation pivot ships; default it off in new installs.

## Out of scope (separate items)

- Per-friend bandwidth quotas backed by metering (separable concern; the policy language *can* express it).
- Group capabilities ("everyone in book-club gets X") — defer until friend count justifies it.
- Public-cap discovery / sharing capabilities by URL — Tahoe-LAFS style, interesting but not core.

## Acceptance criteria

- Alice can issue a scoped, time-bounded cap to Bob during the add-friend ceremony.
- Bob's node can derive a device-scoped cap for his iPhone without contacting Alice.
- Alice's node verifies the device cap offline (no network call).
- Removing Bob as a friend revokes his access within one gossip tick across all of Alice's nodes (if she has multiple).
- A leaked friend-cap, presented from a device with the wrong pubkey, is rejected by audience binding.
- The shared bearer is fully gone from new installs (still readable in legacy config for migration).

## References

- [Biscuit token design](https://github.com/eclipse-biscuit/biscuit/blob/master/DESIGN.md)
- [Biscuit project home](https://www.biscuitsec.org/)
- [UCAN intro (web3.storage)](https://blog.web3.storage/posts/intro-to-ucan)
- [UCAN guide (Fission)](https://fission.codes/ecosystem/ucan/)
- [Tahoe-LAFS capability URIs](https://tahoe-lafs.readthedocs.io/en/latest/architecture.html)
