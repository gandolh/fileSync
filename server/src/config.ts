import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

export type Peer = { name: string; host: string; port: number };

export type ServerConfig = {
  name: string;
  port: number;
  dataDir: string;
  certsDir: string;
  syncIntervalMs: number;
  sharedSecret: string;
  peers: Peer[];
};

function readJson<T>(p: string): T {
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

export function loadConfig(): ServerConfig {
  const configDir = process.env.FILESYNC_CONFIG_DIR
    ? path.resolve(process.env.FILESYNC_CONFIG_DIR)
    : path.resolve(ROOT, "config");

  const serverFile = readJson<{
    name: string;
    port?: number;
    dataDir?: string;
    certsDir?: string;
    syncIntervalMs?: number;
  }>(path.join(configDir, "server.json"));

  const peers = readJson<Peer[]>(path.join(configDir, "peers.json"));

  const sharedSecret = process.env.FILESYNC_SHARED_SECRET;
  if (!sharedSecret || sharedSecret.length < 16) {
    throw new Error(
      "FILESYNC_SHARED_SECRET env var is required (min 16 chars)"
    );
  }

  const dataDir = path.resolve(
    ROOT,
    serverFile.dataDir ?? process.env.FILESYNC_DATA_DIR ?? "data"
  );
  const certsDir = path.resolve(
    ROOT,
    serverFile.certsDir ?? process.env.FILESYNC_CERTS_DIR ?? "certs"
  );

  return {
    name: serverFile.name,
    port: serverFile.port ?? Number(process.env.PORT ?? 3001),
    dataDir,
    certsDir,
    syncIntervalMs: serverFile.syncIntervalMs ?? 30_000,
    sharedSecret,
    peers: peers.filter((p) => p.name !== serverFile.name),
  };
}
