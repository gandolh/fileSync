import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");

await mkdir(DATA_DIR, { recursive: true });

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(multipart, {
  limits: { fileSize: 1024 * 1024 * 1024 },
});

app.get("/health", async () => ({ ok: true }));

app.post("/upload", async (request, reply) => {
  const parts = request.files();
  const saved: { filename: string; bytes: number }[] = [];

  for await (const part of parts) {
    const safeName = path.basename(part.filename).replace(/[^\w.\-]+/g, "_");
    const finalName = `${Date.now()}-${safeName}`;
    const dest = path.join(DATA_DIR, finalName);

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

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "0.0.0.0" });
