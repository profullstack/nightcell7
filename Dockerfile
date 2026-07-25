# NIGHTCELL 7 — single-container deployment.
#
# Runs the whole stack in one Railway service: the gateway binds $PORT and
# proxies to the site, game, API and multiplayer processes on localhost.
# `tools/release/start-all.mjs` is the supervisor.
#
# The target topology is still one Railway service per component (PRD §17.5);
# this image is the simplified shape for early testing. Splitting later means
# changing the gateway's four upstream URLs, not restructuring anything.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json tsup.base.ts ./
COPY packages ./packages
COPY services ./services
COPY apps ./apps
COPY tools ./tools
RUN pnpm install --frozen-lockfile
# Packages, then services (tsup bundles), then apps (Next + Vite).
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Whole tree: `next start` needs its app directory, and the externalised
# native modules (libsql) must be resolvable at runtime.
COPY --from=build /app ./

EXPOSE 8080
CMD ["node", "tools/release/start-all.mjs"]
