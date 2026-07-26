# Railway deployment

All deployable application services run on Railway from **this one repository**
(PRD §17.5, §22.1). No alternative application host is permitted for V1.

## Current shape: one service, not seven

Production today runs the **whole stack in a single Railway service**
(`nightcell7`) from the root `Dockerfile`. `tools/release/start-all.mjs`
supervises the processes and the gateway binds `$PORT`, proxying to the site,
game, API and multiplayer on localhost.

The per-service matrix below is the target topology and the files for it exist
(`infra/docker/<service>.Dockerfile`, `services/*/railway.json`). Splitting is
four environment variables — the gateway's upstream URLs — not a rewrite.

Trade-offs accepted for now: a multiplayer redeploy also restarts the site, and
match servers cannot scale independently. Revisit before real player load.

## Deploy trigger

Pushes to `main` **do** auto-deploy via the GitHub connection.

Two traps that made this look broken:

1. **Watch paths silently skip.** Railway reported `no changes detected in
watch paths, build will skip` and marked deployments `SKIPPED`, not
   `FAILED`. Nothing warns you; the service just never updates.
   `railway.json` now sets `watchPatterns: ["**"]`.
2. **`railway up` supersedes a webhook build.** A manual upload started
   seconds after a push will mark the GitHub-triggered deployment `REMOVED`.
   That is not the webhook failing — check timestamps before concluding it is.

Prefer letting the push deploy. Use `railway up` only to deploy uncommitted
work.

## Railpack does not work here

`railpack` cannot detect a start command in a 20-package pnpm workspace and
fails with "No start command detected". Every service is Dockerfile-built;
`RAILWAY_DOCKERFILE_PATH` selects which one.

Every service below points at the same Git repo with a service-specific root
directory, build command and watch path. A protocol change therefore rebuilds
the client, the API and the match service from one commit.

## Service matrix

| Railway service | Runtime       |                         Public? | Root / build                                               |   Min scale | Purpose                                       |
| --------------- | ------------- | ------------------------------: | ---------------------------------------------------------- | ----------: | --------------------------------------------- |
| `gateway`       | Node 22       | **Yes** — owns `nightcell7.com` | `infra/docker/node-service.Dockerfile` (`SERVICE=gateway`) |           1 | Route HTTP + WS                               |
| `site`          | Node 22       |                              No | `infra/docker/site.Dockerfile`                             |           1 | Next.js marketing/account/store               |
| `game-web`      | Caddy         |                              No | `infra/docker/game-web.Dockerfile`                         |           1 | Vite game + PWA assets                        |
| `api`           | Node 22       |                              No | `node-service.Dockerfile` (`SERVICE=api`)                  |           1 | REST, auth, CoinPay, entitlements             |
| `multiplayer`   | Node 22       |                No (via gateway) | `node-service.Dockerfile` (`SERVICE=multiplayer`)          | 1 per shard | Colyseus authoritative rooms                  |
| `worker`        | Node 22       |                              No | `node-service.Dockerfile` (`SERVICE=worker`)               |           1 | BullMQ background jobs                        |
| `redis`         | Railway Redis |                              No | managed                                                    |           1 | Presence, room directory, queues, rate limits |
| `cron-*`        | Node 22       |                              No | `node-service.Dockerfile` (`SERVICE=cron`)                 |   scheduled | Reconciliation and cleanup                    |

**Only `gateway` gets a public domain.** Internal Railway hostnames must never
appear in a client response (PRD §29.2). Services reach each other over Railway
private networking using `*.railway.internal`.

## Public routing

Owned by `gateway`, in this order — the order is load-bearing:

```
https://nightcell7.com/api/v1/multiplayer/sync/*  -> multiplayer   (WebSocket)
https://nightcell7.com/api/v1/*                   -> api
https://nightcell7.com/play/*                     -> game-web
https://nightcell7.com/*                          -> site
```

If the general `/api/v1/*` rule is evaluated first, every WebSocket upgrade is
swallowed by ordinary API middleware. `services/gateway/src/routes.test.ts`
locks this behaviour down.

## Watch paths

Set these so an art-only change does not rebuild every server, while a
shared-package change rebuilds everything that depends on it.

| Service       | Watch paths                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gateway`     | `services/gateway/**`, `packages/observability/**`, `pnpm-lock.yaml`                                                                                |
| `api`         | `services/api/**`, `packages/{entitlements,coinpay,auth,database,multiplayer-protocol,game-core,content-schema,observability}/**`, `pnpm-lock.yaml` |
| `multiplayer` | `services/multiplayer/**`, `packages/{multiplayer-protocol,multiplayer-sim,game-core,observability}/**`, `pnpm-lock.yaml`                           |
| `worker`      | `services/worker/**`, `packages/{entitlements,coinpay,database,multiplayer-protocol,observability}/**`, `pnpm-lock.yaml`                            |
| `site`        | `apps/site/**`, `packages/{ui,game-core,entitlements}/**`, `pnpm-lock.yaml`                                                                         |
| `game-web`    | `apps/game/**`, `packages/{game-core,multiplayer-protocol,multiplayer-sim,save-data,content-schema,ui}/**`, `public/assets/**`, `pnpm-lock.yaml`    |

## Health checks

Every long-running service exposes `/health/live` and `/health/ready`
(PRD §17.6). Point Railway's healthcheck at `/health/ready` — `live` stays up
during a drain so the platform does not restart a shard that is deliberately
finishing its matches.

- `gateway` — ready once listening.
- `api` — ready once Redis responds to `PING`.
- `multiplayer` — ready once the transport is listening; reports `draining`
  during shutdown so no new rooms are placed on it.
- `worker` — ready once every queue worker is attached.

## Migrations

Database migrations are an **explicit pre-deploy step**, never run concurrently
from every replica (PRD §17.6):

```bash
pnpm --filter @nightcell7/database migrate
```

Run it once against the target environment before rolling the services that
depend on the new schema.

## Deploy and drain

`multiplayer` handles SIGTERM by:

1. locking every room so no new match is placed on the shard;
2. giving in-flight matches a bounded 90 s window to finish;
3. ending anything still running with `service_restart`, which is **not**
   counted as a win or a loss (PRD §18.10).

Set the Railway shutdown grace period above that window (≥ 120 s) or matches
will be killed mid-round.

## Environments

`staging` and `production` are isolated Railway environments built from the same
repository and service definitions, with separate variables and separate data.
CoinPay credentials and webhook secrets **must** differ between them
(PRD §24.1).

## Environment variables

See `.env.example` for the full contract. Each service validates its own slice
at boot and refuses to start in production with a missing secret.

Secrets that must be set per environment:

- `AUTH_SECRET`, `TICKET_SECRET`, `MATCH_RESULT_SECRET` — independent random
  values, minimum 32 bytes. `TICKET_SECRET` must match between `api` (mints) and
  `multiplayer` (verifies). `MATCH_RESULT_SECRET` must match between
  `multiplayer` (signs) and `worker` (verifies).
- `COINPAY_API_KEY`, `COINPAY_WEBHOOK_SECRET`
- `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`
- `RESEND_API_KEY`
- `R2_*`

## Cron jobs

Short-lived commands that execute and exit — never used to host a live match.

| Schedule       | Command                                   |
| -------------- | ----------------------------------------- |
| `*/10 * * * *` | `node dist/index.js reconcile-payments`   |
| `0 * * * *`    | `node dist/index.js expire-orders`        |
| `0 */6 * * *`  | `node dist/index.js cleanup-tickets`      |
| `0 */6 * * *`  | `node dist/index.js cleanup-rooms`        |
| `*/30 * * * *` | `node dist/index.js audit-orphan-results` |

## Adding a shard

1. Create a new Railway service from `services/multiplayer` with
   `MULTIPLAYER_SHARD` set to the new id.
2. Add a gateway route for that shard's path prefix.
3. Add the shard to the API's region/shard table.

The client never changes: it only ever uses the `websocketUrl` the matchmaking
response gives it. Shards are sized and certified by load test before accepting
a maximum room count — never guessed in code (PRD §30.4).

## Pre-production checklist

- [ ] `gateway` owns `nightcell7.com`; no other service has a public domain
- [ ] Staging and production use different CoinPay credentials
- [ ] `TICKET_SECRET` matches between `api` and `multiplayer`
- [ ] `MATCH_RESULT_SECRET` matches between `multiplayer` and `worker`
- [ ] Healthchecks point at `/health/ready`
- [ ] Shutdown grace period ≥ 120 s on `multiplayer`
- [ ] Migrations applied before the dependent deploy
- [ ] Load test has certified the shard's room capacity
- [ ] Rollback procedure documented and rehearsed
