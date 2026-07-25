# NIGHTCELL 7 Project Rules

## Repository

- TypeScript strict mode.
- This is one repository. Never create a separate marketing, game, API, multiplayer, worker, or infrastructure repository.
- Use pnpm workspaces and shared packages for cross-project contracts.
- No Git submodules. No copied cross-repository build artifacts.
- One commit must be able to update the site, game, server protocol, daemons, and Railway deployment together.

## Deployment

- All deployable application services target Railway.
- `nightcell7.com` is the canonical public application origin.
- HTTP API paths live under `/api/v1`.
- Multiplayer sync lives under `/api/v1/multiplayer/sync/...` over WSS.
- Never expose an internal Railway service domain to a client as a stable public contract.
- All long-running Railway services require health checks (`/health/live`, `/health/ready`), structured logs, validated environment variables, and graceful SIGTERM.

## Payments

- CoinPayPortal is the only V1 payment integration.
- Do not add direct Stripe code, keys, webhooks, checkout, or documentation.
- The server-controlled catalog is the price authority. The client never submits an amount.
- Never unlock content from a browser return URL. Only a verified webhook fulfills an order.

## Game architecture

- Babylon owns per-frame client presentation state.
- React/Preact does not own per-frame transforms.
- Keep `game-core` independent of Babylon where practical.
- V1 includes single-player and server-authoritative multiplayer.

## Multiplayer

- The multiplayer client sends input intent, not authoritative position, hits, score, ammo, or results.
- The server owns movement validation, fire cadence, projectiles, damage, death, respawn, score, and match outcome.
- Shared multiplayer messages and schemas belong in `packages/multiplayer-protocol`.
- Server-safe simulation belongs in `packages/multiplayer-sim` and must never import Babylon, the DOM, or Electron.
- Protocol changes require client/server compatibility tests and a version bump when breaking.
- Match tickets are short-lived, one-time, and never contain payment credentials.
- Do not cache `/api`, matchmaking, tickets, or WebSocket traffic in the PWA service worker.

## Product

- Episode 1 has two playable campaigns.
- Neither nationality is the default villain.
- One $9.99 episode includes both campaigns and Complete Truth.
- Multiplayer Alpha is free and cannot be pay-to-win.
- Do not add subscriptions, battle passes, paid weapons, ranked mode, voice chat, or mobile controls to V1.

## Assets

- No public asset without provenance.
- Never overwrite raw assets.
- One Blender meter equals one game meter.
- Production models use GLB and glTF-compatible PBR.
- Colliders use `COL_`.
- Sockets use `SOCKET_`.
- Every weapon has `SOCKET_MUZZLE`.
- Preview and validate every asset.
- WAV masters; compressed runtime audio.
- Repeated sounds require variations.
- Preserve prompts, sources, licenses, and dates.
- Treat MCP servers as executable code.

## Content and culture

- Do not copy another game's map, asset, weapon, UI, logo, story, or marketing site.
- Iranian/Farsi content remains pending until native review.
- All facilities, units, and operations are fictional.

## Marketing site

- The marketing site must not use a default SaaS template aesthetic.
- No untouched shadcn theme, generic rounded feature grid, purple gradient blob, or placeholder stock soldier.
- Marketing routes must not load Babylon.
- Play Free Demo is a dominant CTA; Multiplayer Alpha is visible but does not obscure the campaign offer.
- Reduced motion and accessibility are P0.

## Process

- Maintain client, server-tick, network, memory, and download budgets (PRD §30).
- P1 work cannot displace unfinished P0 work.
- The canonical requirements live in `docs/prd.md`. Update it in the same commit when a decision changes.
