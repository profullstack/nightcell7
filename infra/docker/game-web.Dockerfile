# Static game build served by Caddy behind the gateway.
FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/game ./apps/game
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @nightcell7/game build

FROM caddy:2-alpine AS runtime
COPY --from=build /app/apps/game/dist /srv/play
COPY infra/gateway/game-web.Caddyfile /etc/caddy/Caddyfile
