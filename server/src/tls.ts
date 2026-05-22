import { readFileSync } from "node:fs";
import path from "node:path";
import https from "node:https";

export type TlsMaterial = {
  key: Buffer;
  cert: Buffer;
  ca: Buffer;
};

export function loadTls(certsDir: string): TlsMaterial {
  return {
    key: readFileSync(path.join(certsDir, "server.key")),
    cert: readFileSync(path.join(certsDir, "server.crt")),
    ca: readFileSync(path.join(certsDir, "ca.crt")),
  };
}

export function buildPeerAgent(tls: TlsMaterial): https.Agent {
  return new https.Agent({
    key: tls.key,
    cert: tls.cert,
    ca: tls.ca,
    rejectUnauthorized: true,
    keepAlive: true,
  });
}
