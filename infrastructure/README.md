# Infrastructure

Build artifacts and operational scripts for running fileSync nodes.

## Layout

```
infrastructure/
├── Dockerfile              # multi-stage build for the server
├── docker-compose.yml      # 2-node local cluster (node-a + node-b)
├── scripts/
│   ├── gen-ca.sh           # one-time: create the private CA
│   └── gen-server-cert.sh  # per-node: issue a server cert signed by the CA
├── ca/                     # gitignored — ca.key + ca.crt live here
├── certs/<node>/           # gitignored — server.crt/key + ca.crt per node
└── compose/<node>/config/  # server.json + peers.json per node
```

## One-time CA setup

```bash
cd infrastructure
./scripts/gen-ca.sh ./ca
```

`ca.key` is the **root of trust** for the whole fleet. Keep it offline, off the
servers, and out of git. Only `ca.crt` ships to each node.

## Per-node cert

```bash
./scripts/gen-server-cert.sh node-a node-a 127.0.0.1
./scripts/gen-server-cert.sh node-b node-b 127.0.0.1
```

The SAN list must include every hostname / IP peers will use to connect. The
script writes to `./certs/<name>/` (server.crt, server.key, ca.crt).

## Run the local cluster

```bash
export FILESYNC_SHARED_SECRET=$(openssl rand -hex 32)
docker compose -f infrastructure/docker-compose.yml up --build
```

* node-a mTLS peer API: `https://localhost:3443`
* node-b mTLS peer API: `https://localhost:3444`
* node-a local UI (loopback, bearer only): `http://127.0.0.1:3001`
* node-b local UI (loopback, bearer only): `http://127.0.0.1:3002`

## Trust model

* One **private CA** signs every node's cert. No public CA involved.
* Every node trusts only `ca.crt`. A leaked Let's Encrypt / public cert cannot
  connect to the peer port.
* Peers authenticate each other with **mTLS** (both sides present a CA-signed
  cert).
* On top of mTLS, every request must carry `Authorization: Bearer <SHARED_SECRET>`.
  Defense in depth — a stolen cert without the secret still cannot read data.
* Per-node certs are recommended over one shared cert: you can revoke a single
  compromised node by reissuing the CA with a CRL, or just by rotating the
  shared secret and the affected node's cert.
