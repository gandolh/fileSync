import { createReadStream, createWriteStream } from "node:fs";
import { stat, mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import type { Peer, ServerConfig } from "./config.js";
import type { IndexStore } from "./index-store.js";
import { contentTypeFor, readLocalManifest } from "./manifest.js";
import type { PeerClient } from "./peers.js";

type Deps = {
  config: ServerConfig;
  store: IndexStore;
  client: PeerClient;
};

function safeName(name: string): string {
  // strip path separators and traversal, keep simple filename chars
  return path.basename(name).replace(/[^\w.\-]+/g, "_");
}

export async function registerRoutes(app: FastifyInstance, deps: Deps) {
  const { config, store, client } = deps;
  await mkdir(config.dataDir, { recursive: true });

  app.get("/health", async () => ({ ok: true, name: config.name }));

  // List local files only — used by peers to build their index.
  app.get("/manifest", async () => {
    const files = await readLocalManifest(config.dataDir);
    return { files, name: config.name };
  });

  // Virtual index across local + peers.
  app.get("/index", async () => ({
    name: config.name,
    files: store.list(),
  }));

  // Upload (local only; not peer-facing semantically but same mTLS gate).
  app.post("/upload", async (request, reply) => {
    const parts = request.files();
    const saved: { filename: string; bytes: number }[] = [];

    for await (const part of parts) {
      const finalName = `${Date.now()}-${safeName(part.filename)}`;
      const dest = path.join(config.dataDir, finalName);
      await pipeline(part.file, createWriteStream(dest));
      if (part.file.truncated) {
        return reply.code(413).send({ error: "file too large" });
      }
      saved.push({ filename: finalName, bytes: part.file.bytesRead });
    }
    if (saved.length === 0) {
      return reply.code(400).send({ error: "no files uploaded" });
    }
    return { saved };
  });

  // Fetch a file — locally or transparently proxied from a peer.
  app.get<{ Params: { name: string } }>("/files/:name", async (request, reply) => {
    const requested = safeName(request.params.name);
    const located = store.locate(requested);

    if (located && located.location === "local") {
      const full = path.join(config.dataDir, requested);
      try {
        const s = await stat(full);
        reply
          .header("content-type", contentTypeFor(requested))
          .header("content-length", s.size)
          .header("x-filesync-source", "local");
        return reply.send(createReadStream(full));
      } catch {
        return reply.code(404).send({ error: "not found" });
      }
    }

    if (located) {
      const peer = config.peers.find((p: Peer) => p.name === located.location);
      if (!peer) {
        return reply.code(502).send({ error: "peer not configured" });
      }
      try {
        const upstream = await client.fetchFileStream(peer, requested);
        const ct = upstream.headers["content-type"] ?? contentTypeFor(requested);
        const cl = upstream.headers["content-length"];
        reply
          .header("content-type", ct)
          .header("x-filesync-source", peer.name);
        if (cl) reply.header("content-length", cl);
        return reply.send(upstream);
      } catch (err) {
        request.log.warn({ err, peer: peer.name }, "peer file fetch failed");
        return reply.code(502).send({ error: "peer fetch failed" });
      }
    }

    return reply.code(404).send({ error: "not found" });
  });
}
