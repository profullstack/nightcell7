# Architecture

## Why one repository

The marketing site, game, protocol, daemons and deployment configuration must be
able to change together. A protocol version bump touches
`packages/multiplayer-protocol`, the Babylon client, the Colyseus room, the API
that mints tickets, the tests that prove compatibility, and the Railway watch
paths — all in one commit, reviewed as one change (PRD §17.2).

Separate repositories would let those drift silently, which is exactly the
failure mode a versioned realtime protocol cannot survive.

## Layer boundaries

```
                    packages/game-core          pure rules, no renderer
                            |
        +-------------------+-------------------+
        |                                       |
packages/multiplayer-sim              packages/multiplayer-protocol
 (server-safe simulation)              (wire contract + schemas)
        |                                       |
        +------------------+--------------------+
                           |
        +------------------+------------------+
        |                                     |
   apps/game                          services/multiplayer
 (Babylon presentation,               (Colyseus transport,
  prediction, HUD)                     authoritative rooms)
```

Rules that hold:

- `game-core` and `multiplayer-sim` never import Babylon, the DOM or Electron.
  ESLint enforces this (`no-restricted-imports`).
- Babylon owns per-frame presentation state. Preact/React owns menus, HUD and
  settings — **never** per-frame transforms.
- The Colyseus room is transport and lifecycle. Every gameplay decision lives in
  `MatchSimulation`, which is why the ruleset is testable without a socket.
- `multiplayer-protocol` has a browser-safe main entry and a `./server` entry
  that holds the `node:crypto` code. That split is why a Node built-in can never
  reach a client bundle.

## Request paths

**Control plane** (HTTPS, one origin):

```
browser/PWA/Electron -> gateway -> site | game-web | api
```

**Data plane** (WSS, same origin):

```
browser/PWA/Electron -> gateway -> multiplayer
```

**Durable work** (never inline in a request):

```
api -> Redis (BullMQ) -> worker -> Turso
multiplayer -> Redis (BullMQ) -> worker -> Turso
```

Route precedence at the gateway is load-bearing and unit-tested: the multiplayer
sync path must be matched _before_ the general `/api/v1` path, or every
WebSocket upgrade gets swallowed by ordinary API middleware.

## State placement

| Kind                                                         | Home                 | Why                                         |
| ------------------------------------------------------------ | -------------------- | ------------------------------------------- |
| Live room state                                              | Match process memory | 30 Hz; nothing else can keep up             |
| Presence, room directory, queues, rate limits, ticket nonces | Redis                | Shared across replicas, ephemeral by design |
| Orders, entitlements, match history, profiles, reports       | Turso/libSQL         | Durable, auditable                          |
| Campaign progress, settings, checkpoints                     | Device (IndexedDB)   | V1 keeps saves local; cloud saves are P1    |
| Large content packs                                          | Cloudflare R2        | Entitlement-gated, presigned per object     |

Redis is never the authoritative source for completed commerce or durable match
history. Per-tick state is never written to Turso.

## Failure behaviour

| Failure               | Behaviour                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------ |
| Upstream service down | Gateway returns 502 with a correlation id; no internal hostname leaks                      |
| Redis unavailable     | API readiness fails; matchmaking stops rather than issuing tickets that cannot be consumed |
| Match process dies    | Match marked aborted; not counted as a win or loss                                         |
| Worker backlog        | Orders sit in `paid`, visible to the reconciliation cron; nothing is lost                  |
| Webhook missed        | Cron polls CoinPay and repairs the order state                                             |
| Shard draining        | New rooms refused; in-flight matches finish inside a bounded window                        |
| Client too old        | 426 with `update_required` and a machine-readable code                                     |

## Observability

Every service emits structured JSON with a correlation id propagated from the
gateway. The logger redacts tickets, tokens, secrets, cookies and payer email
by key name _and_ strips `?ticket=` from any URL-shaped string — because the
most likely leak is an error message that happens to contain a connection URL.
