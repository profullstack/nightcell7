# Shared build for the Node services (gateway, api, multiplayer, worker, cron).
#
# One repository, many services (PRD §17.2): each Railway service builds from
# this file with a different SERVICE argument and root directory, so a protocol
# change rebuilds every dependent service from the same commit.
#
# Build with: --build-arg SERVICE=api
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY services ./services
COPY tsconfig.base.json ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
ARG SERVICE
RUN test -n "$SERVICE" || (echo "SERVICE build arg is required" && exit 1)
RUN pnpm --filter "@nightcell7/service-${SERVICE}" build

FROM node:22-slim AS runtime
ARG SERVICE
ENV NODE_ENV=production
WORKDIR /app
# Run unprivileged.
USER node
COPY --from=build --chown=node:node /app/services/${SERVICE}/dist ./dist
# The build bundles workspace dependencies, so no node_modules copy is needed.
CMD ["node", "dist/index.js"]
