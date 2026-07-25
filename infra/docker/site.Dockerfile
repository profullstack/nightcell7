# Next.js marketing site.
#
# Deliberately NOT the `standalone` output: a prior incident on another
# Profullstack service showed standalone breaking a Turbopack build. `next start`
# is the supported path here.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/site ./apps/site
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @nightcell7/site build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app ./
EXPOSE 3000
CMD ["pnpm", "--filter", "@nightcell7/site", "start"]
