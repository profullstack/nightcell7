# NIGHTCELL 7: FALSE DAWN

**Two operatives. Two countries. One manufactured war. Play both sides before the truth disappears.**

A premium episodic first-person shooter that launches from a browser, installs
as a desktop PWA, ships as Electron packages for Windows/macOS/Linux, and
includes a free server-authoritative multiplayer alpha.

- **Free**: launcher, benchmark, training, a 10–15 minute demo from _each_ side,
  and the 6v6 Multiplayer Alpha.
- **Paid**: $9.99 per theater episode — both campaigns, the Complete Truth
  epilogue, every supported platform, no subscription and no microtransactions.

---

## One repository, one origin, one deployment target

This is a **single mandatory monorepo** (PRD §17.2). The marketing site, game,
PWA, desktop wrapper, APIs, multiplayer services, workers, gateway and
infrastructure all live here and change atomically. Separate repositories, git
submodules and copied cross-repo build artifacts are prohibited.

Every deployable application service runs on **Railway**, behind one public
origin:

```
https://nightcell7.com/                          -> site
https://nightcell7.com/play/                     -> game (Babylon + PWA)
https://nightcell7.com/api/v1/*                  -> api
wss://nightcell7.com/api/v1/multiplayer/sync/... -> multiplayer
```

Clients never see an internal Railway hostname.

---

## Layout

```
apps/
  site/         Next.js App Router — marketing, account, library, store
  game/         Babylon.js + Vite — browser game and PWA
  desktop/      Electron wrapper around the same web build
services/
  gateway/      Public path router + WebSocket upgrade proxy (owns the domain)
  api/          Auth, catalog, CoinPay, entitlements, multiplayer tickets
  multiplayer/  Colyseus matchmaker + authoritative rooms
  worker/       BullMQ: payment fulfilment, match results, email
  cron/         Short-lived reconciliation and cleanup commands
packages/
  game-core/            Weapons, damage, difficulty, campaign, match rules
  multiplayer-protocol/ Messages, Colyseus schemas, version handshake, tickets
  multiplayer-sim/      Server-safe movement, hitscan, simulation, bots
  entitlements/         Order state machine, catalog pricing, entitlement rules
  coinpay/              CoinPayPortal client and webhook verification
  database/             Drizzle schema + libSQL client
  auth/ save-data/ content-schema/ observability/ ui/
infra/
  railway/      Service matrix, env contract, deployment runbook
  gateway/      Caddyfile alternative to the TypeScript proxy
  docker/       Service Dockerfiles
  local/        Docker Compose for Redis
tools/
  multiplayer-loadtest/ Simulation load and soak gate
  release/              Local dev orchestrator
docs/           Architecture, multiplayer, CoinPay, PRD traceability
```

---

## Getting started

```bash
pnpm install
cp .env.example .env        # fill in secrets; services refuse to boot without them
pnpm dev:deps               # Redis via Docker Compose
pnpm dev                    # every service, behind the gateway on :8080
```

Local URLs mirror production paths through the gateway, so WebSocket upgrades,
cookies, CORS and route precedence are all exercised before you deploy:

```
http://localhost:8080/                   marketing site
http://localhost:8080/play               game
http://localhost:8080/api/v1/catalog     api
ws://localhost:8080/api/v1/multiplayer/sync/{region}/{shard}/{roomId}
```

### Commands

| Command                                | What it does                                               |
| -------------------------------------- | ---------------------------------------------------------- |
| `pnpm check`                           | format + lint + typecheck + test — run this before pushing |
| `pnpm test`                            | one Vitest run across every workspace                      |
| `pnpm build`                           | packages, then services, then apps                         |
| `pnpm typecheck`                       | strict TypeScript across all workspaces                    |
| `pnpm loadtest`                        | simulation load + soak gate (PRD §34.3)                    |
| `pnpm db:generate` / `pnpm db:migrate` | Drizzle migrations                                         |

---

## The three rules worth knowing before you write code

**1. The server decides multiplayer truth.**
The client sends _input intent_ — movement axes, view angles, a button bitfield.
It never sends a position, a hit, an ammo count or a score. `packages/multiplayer-sim`
runs the same movement code on both sides, so client prediction agrees with the
server; when it does not, the server wins. There is a test that asserts exactly
this (`apps/game/src/net/prediction.test.ts`).

**2. Only a verified webhook unlocks content.**
The browser return URL from CoinPay shows _pending_ and nothing more. An order
reaching `paid` still unlocks nothing — fulfilment is a separate, retryable
state. The provider event id carries a unique constraint, so a replayed webhook
is a no-op rather than a second grant.

**3. Neither side is the villain.**
The American route is not "good mode" and the Iranian route is not "enemy mode".
Both protagonists have a defensible mission, incomplete intelligence and reason
to distrust the other. All facilities, units and operations are fictional, and
Farsi content stays pending until native review.

Full rules for contributors and agents: [`CLAUDE.md`](./CLAUDE.md).

---

## Status

Implemented and tested:

- Shared gameplay rules, weapons, damage/armour, difficulty, campaign structure
- Authoritative simulation: movement, collision, hitscan with bounded lag
  compensation, spawn scoring, TDM scoring, respawn, reconnect seats, bots
- Multiplayer protocol: versioned handshake, input sanitisation, Colyseus room
  state, one-time signed tickets, signed match results
- Client prediction, reconciliation and remote interpolation
- Gateway route precedence and header sanitisation
- API surface from PRD §29, including ticket minting and the CoinPay webhook
- Order state machine, catalog pricing authority, entitlement grant/revoke
- Colyseus room, worker fulfilment, cron reconciliation
- Railway topology, Dockerfiles, CI and release workflows

Not yet built (tracked against the PRD milestones):

- Mission content, art, audio and the asset/Blender pipeline
- R2 manifest signing and offline licence issuance
- Better Auth wiring for registration/verification/reset
- The remaining marketing routes and final art direction
- Network-level (real WebSocket client) load testing against a deployed shard

See [`docs/prd.md`](./docs/prd.md) for section-by-section traceability.

---

## Legal and ethical gates

The following are **mandatory before public launch** and none of them are
satisfied yet: title and domain clearance, trademark review, CoinPay production
approval, digital tax review, cultural and Farsi review, asset-license
provenance audit, multiplayer load certification, and Railway production
readiness.

> NIGHTCELL 7 is a fictional work set in an invented near-future crisis. Its
> organizations, facilities, operations, and characters are fictional. The game
> does not depict or endorse any real government, military operation, political
> movement, or current event.
