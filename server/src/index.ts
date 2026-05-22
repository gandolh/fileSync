import { mkdir } from "node:fs/promises";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { loadConfig } from "./config.js";
import { loadTls, buildPeerAgent } from "./tls.js";
import { bearerAuth } from "./auth.js";
import { IndexStore } from "./index-store.js";
import { PeerClient } from "./peers.js";
import { startSync } from "./sync.js";
import { registerRoutes } from "./routes.js";

const config = loadConfig();
await mkdir(config.dataDir, { recursive: true });

const tls = loadTls(config.certsDir);
const peerAgent = buildPeerAgent(tls);
const store = new IndexStore();
const client = new PeerClient({ agent: peerAgent, sharedSecret: config.sharedSecret });

// Peer-facing HTTPS server with mTLS + bearer.
const peerApp = Fastify({
  logger: { name: `peer:${config.name}` },
  https: {
    key: tls.key,
    cert: tls.cert,
    ca: tls.ca,
    requestCert: true,
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
  },
  trustProxy: false,
});

await peerApp.register(multipart, {
  limits: { fileSize: 1024 * 1024 * 1024 },
});
peerApp.addHook("onRequest", bearerAuth(config.sharedSecret));
await registerRoutes(peerApp, { config, store, client });

const peerPort = config.port;
await peerApp.listen({ port: peerPort, host: "0.0.0.0" });
peerApp.log.info(
  { port: peerPort, peers: config.peers.map((p) => p.name) },
  "peer mTLS server listening"
);

const stopSync = startSync({
  dataDir: config.dataDir,
  peers: config.peers,
  store,
  client,
  intervalMs: config.syncIntervalMs,
  log: peerApp.log,
});

// Optional localhost-only HTTP listener for the local browser UI.
// Browsers can't easily present a client cert, so this listener is bound to
// 127.0.0.1 and still requires the bearer token.
const uiPort = Number(process.env.FILESYNC_UI_PORT ?? 3001);
const uiEnabled = process.env.FILESYNC_DISABLE_UI !== "1";

let uiApp: ReturnType<typeof Fastify> | undefined;
if (uiEnabled) {
  uiApp = Fastify({ logger: { name: `ui:${config.name}` } });
  await uiApp.register(cors, { origin: true });
  await uiApp.register(multipart, {
    limits: { fileSize: 1024 * 1024 * 1024 },
  });
  uiApp.addHook("onRequest", bearerAuth(config.sharedSecret));
  await registerRoutes(uiApp, { config, store, client });
  await uiApp.listen({ port: uiPort, host: "127.0.0.1" });
  uiApp.log.info({ port: uiPort }, "local UI listener (loopback only)");
}

const shutdown = async (signal: string) => {
  peerApp.log.info({ signal }, "shutting down");
  stopSync();
  await Promise.allSettled([peerApp.close(), uiApp?.close()]);
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
