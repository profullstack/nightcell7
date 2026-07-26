# NIGHTCELL 7 — PRD traceability

Canonical requirements: **NIGHTCELL 7: FALSE DAWN — PRD V1.3** (25 July 2026).

This file records the locked decisions and maps each PRD section to the code
that implements it. When a decision changes, update this file in the same
commit as the code (CLAUDE.md).

> **Not yet in the repo:** the full narrative PRD text (story bible, mission
> scripts, art-direction prose, asset inventory). Commit it as
> `docs/prd-v1.3.md` so the document CLAUDE.md points at is actually here.
> This file is the engineering-facing extract and index, not a replacement.

---

## Locked V1 decisions (PRD §2)

| Area                             | Decision                                                                 |
| -------------------------------- | ------------------------------------------------------------------------ |
| Working title                    | NIGHTCELL 7                                                              |
| Episode 1                        | FALSE DAWN                                                               |
| Genre                            | First-person tactical action shooter, single-player + online multiplayer |
| Camera                           | First person                                                             |
| Story structure                  | Two playable opposing perspectives                                       |
| First theater                    | Fictional near-future Iran crisis                                        |
| Free product                     | Launcher, benchmark, training, dual-side demo, Multiplayer Alpha         |
| Episode price                    | **$9.99 USD**                                                            |
| Purchase includes                | Both sides, Complete Truth epilogue, all platforms                       |
| Subscription / microtransactions | **None**                                                                 |
| Multiplayer                      | P0 V1 requirement, server-authoritative                                  |
| V1 multiplayer mode              | 6v6 Team Deathmatch, private matches, optional bot fill                  |
| V1 multiplayer map               | Ardavan Yard (derived from Episode 1 architecture)                       |
| V1 throwable                     | **Frag grenade only** — 2 per life, no resupply, no other gadget         |
| Multiplayer access               | Free to verified accounts, no pay-to-win                                 |
| Runtime target                   | 60–90 minutes per campaign side                                          |
| Engine / build                   | Babylon.js / Vite                                                        |
| Physics                          | Havok client-side; simplified authoritative server simulation            |
| UI                               | Preact for menus and HUD only                                            |
| Marketing site                   | Next.js App Router, custom art-directed design system                    |
| Repository                       | **One** Git repository and pnpm workspace                                |
| Separate repositories            | **Prohibited** for V1                                                    |
| Deployment                       | **Railway** for every deployable application service                     |
| Public domain                    | `nightcell7.com`                                                         |
| API base                         | `https://nightcell7.com/api/v1`                                          |
| Realtime endpoint                | `wss://nightcell7.com/api/v1/multiplayer/sync/...`                       |
| Multiplayer framework            | Colyseus on Node.js                                                      |
| Ephemeral realtime state         | Railway Redis                                                            |
| Durable database                 | Turso/libSQL + Drizzle                                                   |
| Authentication                   | Better Auth, verified email                                              |
| Payments                         | **CoinPayPortal only** — direct Stripe integration prohibited            |
| Email                            | Resend                                                                   |
| Asset/content storage            | Cloudflare R2                                                            |
| Mobile touch play                | Out of scope                                                             |
| DRM                              | Low-friction entitlement, no invasive DRM                                |

---

## Section index

| PRD §    | Requirement                                                    | Implementation                                                                                 |
| -------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| §5.2     | $9.99 episode, one purchase covers both sides                  | `packages/entitlements/src/catalog.ts`                                                         |
| §5.4     | No pay-to-win in multiplayer                                   | `packages/game-core/src/weapons.ts` (`multiplayer` flag), `multiplayer-sim` loadout filter     |
| §5.6     | Refund revokes entitlement, free multiplayer unaffected        | `packages/entitlements/src/entitlements.ts`                                                    |
| §8       | Six mission variants over three shared locations               | `packages/game-core/src/campaign.ts`                                                           |
| §8.1–8.2 | Shared timeline and cross-campaign events                      | `campaign.ts` (`SHARED_TIMELINE`)                                                              |
| §9       | Free demo, either side first, no account required              | `game-core/src/ids.ts` (`DEMO_MISSIONS`), `progress.ts` (`canStartMission`)                    |
| §10.7    | Complete Truth unlocks only after both sides                   | `progress.ts` (`shouldUnlockCompleteTruth`)                                                    |
| §12.1    | Movement set and feel                                          | `packages/multiplayer-sim/src/movement.ts`                                                     |
| §23.1    | Free sandbox scenes need no account                            | `apps/game/src/modes.ts`, `access.ts` (`PLAY_MODE.SANDBOX`)                                    |
| §12.4    | Health/armour, regen ceiling, no bullet sponges                | `packages/game-core/src/damage.ts`                                                             |
| §12.6    | Difficulty changes tactics, not enemy health                   | `packages/game-core/src/difficulty.ts`                                                         |
| §13.1    | Four hero weapons, fictional                                   | `packages/game-core/src/weapons.ts`                                                            |
| §13.2    | One throwable: the frag grenade                                | `packages/game-core/src/grenades.ts`, `multiplayer-sim/src/grenades.ts`                        |
| §13.3    | Friendly-fire and identification rules                         | `multiplayer-sim/src/hitscan.ts` (team filter), `grenades.ts` (`resolveBlast`)                 |
| §17.2    | Single-repository mandate                                      | `pnpm-workspace.yaml`, `CLAUDE.md`                                                             |
| §17.3    | Monorepo layout                                                | repository root                                                                                |
| §17.5    | Railway topology and public routing                            | `infra/railway/`, `services/gateway/src/routes.ts`                                             |
| §17.6    | Health checks, structured logs, env validation, SIGTERM        | `packages/observability/src/index.ts`                                                          |
| §17.7    | Local development mirrors production paths                     | `tools/release/dev.mjs`                                                                        |
| §18.1    | Multiplayer Alpha scope                                        | `packages/game-core/src/match-rules.ts`                                                        |
| §18.2    | Ardavan Yard, headless collision map, checksum                 | `multiplayer-sim/src/map.ts`                                                                   |
| §18.3    | Authority model — what the server owns                         | `multiplayer-sim/src/simulation.ts`                                                            |
| §18.4    | Prediction, reconciliation, interpolation                      | `apps/game/src/net/prediction.ts`                                                              |
| §18.5    | Handshake and machine-readable rejections                      | `multiplayer-protocol/src/{version,codes}.ts`                                                  |
| §18.6    | Canonical endpoints, one-time tickets                          | `multiplayer-protocol/src/ticket.ts`, `services/api`                                           |
| §18.7    | Gateway/API/multiplayer/worker/cron daemons                    | `services/*`                                                                                   |
| §18.8    | Sharding, regions, drain                                       | `services/multiplayer/src/index.ts`                                                            |
| §18.10   | Reconnect grace, aborted matches not counted                   | `simulation.ts` (`expiredSeats`), `codes.ts` (`isRankableTermination`)                         |
| §18.11   | Bots use the same rules, labelled, never counted as players    | `multiplayer-sim/src/bots.ts`                                                                  |
| §18.12   | Moderation: reports, blocks, bounded quick chat                | `services/api/src/app.ts`, `multiplayer-protocol/src/messages.ts`                              |
| §19      | Local save schema and migration                                | `packages/save-data/src/index.ts`                                                              |
| §20      | Marketing site product requirements                            | `apps/site/`                                                                                   |
| §21      | DIVIDED SIGNAL art direction                                   | `apps/site/app/globals.css`, `packages/ui/src/index.ts`                                        |
| §22.5    | Performance budgets, API never cached                          | `apps/game/vite.config.ts`, gateway/API `cache-control`                                        |
| §23      | Access model, display names, guest claim, sessions             | `packages/auth/src/index.ts`                                                                   |
| §24      | CoinPayPortal only: checkout, states, webhooks, reconciliation | `packages/coinpay/`, `packages/entitlements/src/orders.ts`, `services/worker`, `services/cron` |
| §25      | Data model                                                     | `packages/database/src/schema.ts`                                                              |
| §26      | Entitlements and content delivery                              | `packages/entitlements/`, `packages/content-schema/`                                           |
| §27      | PWA caching rules                                              | `apps/game/vite.config.ts`                                                                     |
| §28      | Electron security, purchase flow, cross-play                   | `apps/desktop/src/{main,preload}.ts`                                                           |
| §29      | Centralised API surface                                        | `services/api/src/app.ts`                                                                      |
| §30.4    | Tick rate, snapshot rate, rewind cap, budgets                  | `multiplayer-sim/src/constants.ts`                                                             |
| §33.1    | Gateway security headers, forwarding trust                     | `services/gateway/src/routes.ts`                                                               |
| §33.3    | Multiplayer integrity and anti-cheat posture                   | `simulation.ts`, `input.ts`                                                                    |
| §34      | QA — unit, integration, load/soak                              | `*.test.ts`, `tools/multiplayer-loadtest/`                                                     |
| §36      | Scope priorities                                               | this file + `README.md` status                                                                 |

---

## Budgets held in code

Changing any of these is a product decision, not a tuning tweak.

| Budget                            | Value                                | Source of truth                            |
| --------------------------------- | ------------------------------------ | ------------------------------------------ |
| Authoritative tick                | 30 Hz (33.3 ms)                      | `multiplayer-sim/src/constants.ts`         |
| Snapshot cadence                  | ~20 Hz                               | same                                       |
| Accepted client input             | ≤60 Hz                               | `multiplayer-protocol/src/input.ts`        |
| Movement time per player per tick | 1.25 × tick                          | `simulation.ts` (`DT_BUDGET_PER_TICK_MS`)  |
| Lag-compensation rewind cap       | 200 ms                               | `constants.ts` (`MAX_REWIND_MS`)           |
| Remote interpolation delay        | ~100 ms                              | `apps/game/src/net/prediction.ts`          |
| Reconnect seat hold               | 20 s                                 | `game-core/src/match-rules.ts`             |
| p95 server simulation             | < 20 ms at certified capacity        | `tools/multiplayer-loadtest`               |
| Ticket TTL                        | 30–60 s, single use                  | `services/api/src/env.ts`                  |
| Shell download                    | ≤ 15 MB                              | `content-schema` (`DOWNLOAD_BUDGET_BYTES`) |
| Demo route download               | ≤ 150 MB                             | same                                       |
| Paid episode                      | ≤ 1.2 GB preferred, 1.5 GB hard gate | same                                       |
| Multiplayer incremental           | ≤ 250 MB                             | same                                       |

---

## Prohibited in V1

Encoded in `CLAUDE.md` and enforced by review:

- A second payment processor, or any direct Stripe code, keys, webhooks or docs
- Subscriptions, battle passes, loot boxes, paid weapons, paid matchmaking priority
- Ranked play, skill rating, clans, tournaments, voice chat, free-form text chat
- Spectator mode, replays, co-op campaign, player-hosted authoritative servers
- Peer-to-peer or host-migrated multiplayer authority
- Kernel-level anti-cheat
- Native mobile play
- Throwables beyond the frag grenade — the other five entries in `GADGET` are
  campaign fiction, not multiplayer content, and stay that way for V1
- Separate repositories for the site, game, backend, multiplayer or infrastructure
- Direct client connections to internal Railway service domains
- Selling the second campaign or the true ending separately

---

## Open gates before public launch

| Gate                                                       | Owner       | Status                        |
| ---------------------------------------------------------- | ----------- | ----------------------------- |
| Title and domain clearance (registrar checkout + lock)     | Product     | Not started                   |
| Trademark screening (USPTO/WIPO/EUIPO/UKIPO + common law)  | Legal       | Not started                   |
| CoinPayPortal production approval                          | Product     | Not started                   |
| Digital tax classification and jurisdiction review         | Finance     | Not started                   |
| Iranian/Iranian-diaspora cultural consultant               | Product     | Not started                   |
| Native Farsi dialogue, subtitle and signage review         | Product     | Not started                   |
| Asset provenance and license audit                         | Tech art    | Not started                   |
| Multiplayer network load certification on a deployed shard | Engineering | Simulation gate only          |
| Railway production readiness checklist                     | Engineering | See `infra/railway/README.md` |
| Security review                                            | Engineering | Not started                   |
| Visual QA against signed-off design                        | Design      | Design not signed off         |
