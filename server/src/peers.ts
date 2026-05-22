import https from "node:https";
import type { IncomingMessage } from "node:http";
import type { Peer } from "./config.js";
import type { ManifestEntry } from "./manifest.js";

type PeerClientOpts = {
  agent: https.Agent;
  sharedSecret: string;
};

export class PeerClient {
  constructor(private opts: PeerClientOpts) {}

  private request(peer: Peer, path: string): Promise<IncomingMessage> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          host: peer.host,
          port: peer.port,
          path,
          method: "GET",
          agent: this.opts.agent,
          headers: { authorization: `Bearer ${this.opts.sharedSecret}` },
          servername: peer.host,
        },
        (res) => {
          if (!res.statusCode || res.statusCode >= 400) {
            res.resume();
            reject(new Error(`peer ${peer.name} returned ${res.statusCode}`));
            return;
          }
          resolve(res);
        }
      );
      req.on("error", reject);
      req.end();
    });
  }

  async fetchManifest(peer: Peer): Promise<ManifestEntry[]> {
    const res = await this.request(peer, "/manifest");
    const chunks: Buffer[] = [];
    for await (const c of res) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString("utf8");
    const parsed = JSON.parse(body) as { files: ManifestEntry[] };
    return parsed.files;
  }

  fetchFileStream(peer: Peer, filename: string): Promise<IncomingMessage> {
    return this.request(peer, `/files/${encodeURIComponent(filename)}`);
  }
}
