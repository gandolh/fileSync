# syntax=docker/dockerfile:1.7
# Multi-stage build for the fileSync server.
# Build context should be the repo root: `docker build -f infrastructure/Dockerfile .`

FROM node:22-alpine AS deps
WORKDIR /app
COPY server/package.json server/package-lock.json* ./
RUN npm install --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY server/package.json server/tsconfig.json ./
COPY server/src ./src
RUN npx tsc

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache tini openssl \
 && addgroup -S filesync && adduser -S filesync -G filesync

COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist          ./dist
COPY server/package.json             ./package.json

# Volumes — bind-mount real content at runtime.
#   /app/data    persistent file storage
#   /app/certs   ca.crt + server.crt + server.key for this node
#   /app/config  server.json + peers.json
RUN mkdir -p /app/data /app/certs /app/config \
 && chown -R filesync:filesync /app

USER filesync
EXPOSE 3443 3001

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
