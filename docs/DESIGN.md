# fileSync — Design

## The idea in one paragraph

A small fleet of servers — call them **nodes** — each owns a local `data/`
directory of files (images, videos, anything). Every node publishes a manifest
of what it holds. Every node pulls the manifests of every other node on a
timer. The result is a **virtual index**: one merged list of `(filename →
which node has it)` available on every node. When a user asks any node for a
file, that node serves it locally if it has it, or transparently streams it
from the peer that does. All inter-node traffic goes over **mutual TLS**
backed by a **private CA**, plus a shared **bearer token** on top.

## Goals

- Any node can answer "what files exist across the fleet?"
- Any node can serve any file in the fleet (proxying when needed) over HTTPS.
- Trust is fleet-internal — no public Certificate Authority involved.
- Compromising one node should not silently grant access from outside the fleet.

## Non-goals (for now)

- Automatic file replication / eventual convergence of `data/` directories.
- Conflict resolution when two nodes upload the same filename independently
  (current behavior: local wins, then first peer in the index).
- Dynamic peer discovery, gossip, consensus.
- Per-user access control. The bearer token is fleet-wide.

## Architecture

```
                ┌──────────────────────────────────────┐
                │             Virtual index            │
                │   filename → location (node-x | local) │
                └──────────────────────────────────────┘
                            ▲           ▲
              periodic pull │           │ periodic pull
                            │           │
   ┌──────────────────┐     │           │     ┌──────────────────┐
   │      node-a      │◀────┘           └────▶│      node-b      │
   │                  │                       │                  │
   │  data/           │   mTLS HTTPS (3443)   │  data/           │
   │  ├─ a.mp4        │ ◀───────────────────▶ │  ├─ b.png        │
   │  └─ shared.jpg   │   GET /manifest       │  └─ shared.jpg   │
   │                  │   GET /files/:name    │                  │
   └──────────────────┘                       └──────────────────┘
        ▲                                              ▲
        │ loopback HTTP                                │
        │ 127.0.0.1:3001                               │
        │ (bearer-gated)                               │
        │                                              │
   ┌──────────┐                                  ┌──────────┐
   │ Local UI │                                  │ Local UI │
   │ (Vite)   │                                  │ (Vite)   │
   └──────────┘                                  └──────────┘
```

### Components

| Component | File | Responsibility |
| --- | --- | --- |
| Config loader | `server/src/config.ts` | Reads `server.json`, `peers.json`, and `FILESYNC_SHARED_SECRET` env. |
| TLS material | `server/src/tls.ts` | Loads `ca.crt` + `server.crt` + `server.key`. Builds a peer-side `https.Agent`. |
| Bearer auth hook | `server/src/auth.ts` | Constant-time bearer comparison. Runs as Fastify `onRequest`. |
| Local manifest | `server/src/manifest.ts` | Walks `data/`, returns `{name,size,mtime,contentType}`. |
| Index store | `server/src/index-store.ts` | In-memory merge of local + peer manifests. |
| Peer client | `server/src/peers.ts` | mTLS+bearer HTTP client for `/manifest` and `/files/:name`. |
| Sync loop | `server/src/sync.ts` | Every `syncIntervalMs`: re-read local; refetch each peer; update store. |
| Routes | `server/src/routes.ts` | `/health`, `/manifest`, `/index`, `/upload`, `/files/:name`. |
| Entrypoint | `server/src/index.ts` | Two listeners: peer-facing HTTPS+mTLS, optional loopback UI. |

### HTTP surface

All endpoints require `Authorization: Bearer <SHARED_SECRET>`. Peer-facing
endpoints additionally require a client cert signed by the fleet CA.

| Method | Path | Use |
| --- | --- | --- |
| GET | `/health` | Liveness probe — returns `{ ok, name }`. |
| GET | `/manifest` | This node's local files only. Peers consume this. |
| GET | `/index` | Merged virtual index — what the UI lists. |
| POST | `/upload` | Multipart upload into this node's `data/`. |
| GET | `/files/:name` | Stream a file. Serves locally if owned; proxies from the owning peer otherwise. |

### Two listeners, one process

A browser cannot easily present a client certificate, so the server runs two
Fastify instances backed by the same routes:

1. **Peer listener** — HTTPS on port `3443`, `requestCert: true`,
   `rejectUnauthorized: true`, trusting only `ca.crt`. This is what other nodes
   talk to.
2. **Local UI listener** — plain HTTP bound to `127.0.0.1:3001`. Still requires
   the bearer token. Vite's dev proxy injects the bearer so the secret never
   reaches the browser. Disabled with `FILESYNC_DISABLE_UI=1`.

### Sync strategy

- Periodic pull (default 30s). Each tick:
  1. Re-read the local `data/` manifest.
  2. In parallel, `GET /manifest` from every peer.
  3. Replace each peer's slice of the store; on failure, drop that peer's
     slice so a dead node doesn't keep stale entries.

Chosen because it's the simplest thing that produces a consistent answer in
bounded time. Trade-off: an upload on node-A is invisible to node-B until
B's next pull. Acceptable for media-sharing use cases.

### Conflict resolution

If a filename appears on multiple nodes, the index resolves it in this order:

1. Local — if this node holds it, return local.
2. First peer (by config order) whose manifest contains it.

This is deterministic and explainable. It is **not** content-aware: two
different files with the same name will collide. The upload path mitigates
this by prefixing each upload with `Date.now()` so accidental name collisions
between nodes are rare.

## Security model

### Trust anchor: a private CA

A single root certificate (`ca.crt`) is the **only** thing every node trusts
for inter-node TLS. The matching `ca.key` is generated once and kept offline.
No public CA (Let's Encrypt, DigiCert, etc.) is involved, so an attacker
holding a publicly-issued cert for any hostname cannot connect to the peer
port.

### Mutual TLS

Both endpoints of every peer-to-peer connection present a certificate signed
by `ca.crt`. The server uses `requestCert: true` + `rejectUnauthorized: true`;
the client uses an `https.Agent` configured with the fleet `ca`, `cert`, and
`key`. A peer with no cert, an expired cert, or a cert signed by anyone else
fails the handshake before any application code runs.

### Shared bearer token (defense in depth)

Layered on top of mTLS, every request must include
`Authorization: Bearer <FILESYNC_SHARED_SECRET>`. Comparison uses
`crypto.timingSafeEqual`. Rationale: if a node's private key leaks (disk
backup compromise, misplaced cert bundle), the attacker still needs the
shared secret to read any data. Rotation = redeploy with a new env var.

### Why per-node certs instead of one shared cert

The user suggested "same certificate on every node." That works but has
downsides:

- A single leak burns the whole fleet — you cannot revoke just one node.
- Logs cannot distinguish which node initiated a request.
- Re-key requires touching every node at once.

Per-node certs signed by one CA give the same trust property (one trust
anchor, fleet-internal) without those downsides. Each node still gets its
own keypair; only `ca.crt` is shared.

### What we deliberately don't do

- **No CRL or OCSP yet.** Revoking a leaked node cert today = rotate the
  shared secret + reissue. For a small fleet this is fine; for a larger one
  we'd add a CRL distribution point to the CA config.
- **No browser-facing mTLS.** Browsers technically support client certs but
  the UX is awful (per-site prompts, no API to manage them). The UI listener
  on loopback + bearer is a deliberate compromise.

## Operational layout

```
fileSync/
├── client/                 # Vite + React SPA (upload + browse virtual index)
├── server/
│   ├── src/                # Fastify server (see component table above)
│   ├── config/             # server.json + peers.json (gitignored)
│   ├── certs/              # per-node TLS material (gitignored)
│   └── data/               # the dedicated folder this node owns (gitignored)
├── infrastructure/
│   ├── Dockerfile          # multi-stage build, non-root, tini
│   ├── docker-compose.yml  # 2-node local cluster for testing
│   ├── scripts/
│   │   ├── gen-ca.sh           # one-time: create the private CA
│   │   └── gen-server-cert.sh  # per-node: issue a CA-signed cert with SANs
│   ├── compose/<node>/config/  # per-node server.json + peers.json
│   ├── ca/                 # CA key + cert (gitignored)
│   └── certs/<node>/       # issued node certs (gitignored)
└── docs/
    └── DESIGN.md           # this file
```

## Bootstrap walkthrough

1. **Create the CA once.** `infrastructure/scripts/gen-ca.sh ./ca` produces
   `ca.key` (offline-only) and `ca.crt` (shipped to every node).
2. **Issue a cert per node.** `gen-server-cert.sh node-a node-a 10.0.0.5`
   produces `server.key`, `server.crt`, and copies `ca.crt` next to them.
   The SAN list must contain every hostname/IP that peers will dial.
3. **Generate the shared secret.** `openssl rand -hex 32` → put it in each
   node's environment as `FILESYNC_SHARED_SECRET`.
4. **Write `peers.json`.** Same content on every node — one entry per
   participating node. The server filters out its own entry by name.
5. **Run.** Locally via `npm run dev` (server) + `npm run dev` (client), or
   the whole cluster via `docker compose up`.

## Lifecycle scenarios

### A new file appears on node-A

1. User uploads via node-A's local UI → file lands in node-A's `data/`.
2. Within `syncIntervalMs`, node-A's sync loop re-reads its local manifest
   and updates its own slice of the store.
3. On the next tick, node-B pulls node-A's `/manifest` and adds the file to
   its store with `location: "node-a"`.
4. A user on node-B now sees the file in `/index`. Requesting it from
   node-B triggers a streamed mTLS fetch from node-A. node-B does not cache.

### A peer goes down

- node-A's next `GET /manifest` to node-B fails (connection refused, TLS
  error, timeout).
- The sync loop logs a warning and calls `store.forgetPeer("node-b")`.
- node-B's files disappear from node-A's `/index` on that tick.
- When node-B comes back, the next tick repopulates its slice.

### A node cert leaks

- Generate a new keypair for the affected node, reissue with `gen-server-cert.sh`.
- Rotate `FILESYNC_SHARED_SECRET` across the whole fleet (defense in depth
  catches anyone replaying the old cert in the window before redeploy).
- Future work: add a CRL so the CA can revoke the leaked cert without
  reissuing every other node.

## Open questions / future work

- Replication: should files automatically copy from the owner node to N
  replicas for availability?
- Eviction / size budget per node.
- Per-user auth and audit log instead of one fleet-wide bearer.
- CRL or short-lived certs via something like `step-ca`.
- Range requests on `/files/:name` so video previews can seek.
