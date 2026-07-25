# NIGHTCELL 7 — gateway service.
#
# Thin wrapper over the shared build so Railway needs no build arguments.
# Point the Railway service at this file via RAILWAY_DOCKERFILE_PATH or
# services/gateway/railway.json; railpack cannot auto-detect a start command in
# a 20-package workspace and must be bypassed.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS build
# The whole workspace is copied because services bundle workspace packages;
# a partial copy would break the pnpm lockfile resolution.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json tsup.base.ts ./
COPY packages ./packages
COPY services ./services
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @nightcell7/service-gateway build

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable

# Native modules (libsql) stay external, so runtime deps must be installed.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY services ./services
RUN pnpm install --frozen-lockfile --prod --filter @nightcell7/service-gateway...

COPY --from=build /app/services/gateway/dist ./services/gateway/dist

USER node
CMD ["node", "services/gateway/dist/index.js"]
