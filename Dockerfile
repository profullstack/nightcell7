# NIGHTCELL 7 — single-container deployment, run on Bun.
#
# Runs the whole stack in one container: the gateway binds $PORT and proxies to
# the site, game, API and multiplayer processes on localhost.
# `tools/release/start-all.mjs` is the supervisor; it starts every child with
# process.execPath, so all of them run on Bun.
#
# The target topology is still one service per component (PRD §17.5); this image
# is the simplified shape. Splitting later means changing the gateway's four
# upstream URLs, not restructuring anything.
#
# dev2 builds this file (/home/anthony/www/nightcell7.com, `dockerfile: Dockerfile`)
# and passes a PUBLIC_ORIGIN build arg. The Node image never declared it, so the
# build never saw it; it is deliberately still undeclared, keeping the build
# identical. Port 8080, env and the /health/ready path are unchanged.
FROM oven/bun:1.4.0-slim AS base
WORKDIR /app

FROM base AS build
COPY package.json bun.lock tsconfig.base.json tsup.base.ts ./
COPY packages ./packages
COPY services ./services
COPY apps ./apps
COPY tools ./tools
# The desktop app is never packaged in this image, so skip Electron's ~100 MB
# binary download that its postinstall would otherwise fetch.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN bun install --frozen-lockfile
# Packages, then services (tsup bundles), then apps (Next + Vite).
RUN bun run build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Whole tree: `next start` needs its app directory, and the externalised
# database driver (pg) must be resolvable at runtime.
COPY --from=build --chown=bun:bun /app ./

# The oven/bun image ships a non-root `bun` user; nothing here writes to disk.
USER bun
EXPOSE 8080
CMD ["bun", "tools/release/start-all.mjs"]
