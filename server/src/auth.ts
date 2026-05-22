import type { FastifyReply, FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function bearerAuth(sharedSecret: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers["authorization"];
    if (typeof header !== "string" || !header.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "missing bearer token" });
    }
    const token = header.slice("Bearer ".length).trim();
    if (!safeEqual(token, sharedSecret)) {
      return reply.code(401).send({ error: "invalid bearer token" });
    }
  };
}
