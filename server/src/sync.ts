import type { FastifyBaseLogger } from "fastify";
import type { Peer } from "./config.js";
import type { IndexStore } from "./index-store.js";
import { readLocalManifest } from "./manifest.js";
import type { PeerClient } from "./peers.js";

type SyncOpts = {
  dataDir: string;
  peers: Peer[];
  store: IndexStore;
  client: PeerClient;
  intervalMs: number;
  log: FastifyBaseLogger;
};

export function startSync(opts: SyncOpts): () => void {
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const local = await readLocalManifest(opts.dataDir);
      opts.store.setLocal(local);
    } catch (err) {
      opts.log.warn({ err }, "failed to read local manifest");
    }

    await Promise.allSettled(
      opts.peers.map(async (peer) => {
        try {
          const files = await opts.client.fetchManifest(peer);
          opts.store.setPeer(peer.name, files);
        } catch (err) {
          opts.log.warn({ err, peer: peer.name }, "peer manifest fetch failed");
          opts.store.forgetPeer(peer.name);
        }
      })
    );
  };

  // run once immediately, then on interval
  void tick();
  const handle = setInterval(tick, opts.intervalMs);

  return () => {
    stopped = true;
    clearInterval(handle);
  };
}
