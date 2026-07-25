# Multiplayer

> **One battlefield. Two factions. The server decides what happened.**

The V1 Multiplayer Alpha is free to verified accounts: 6v6 Team Deathmatch on
one map, with quick match, private codes and bot fill, cross-play across
browser, PWA, Windows, macOS and Linux.

## The authority boundary

The client sends **input intent**. That is the whole vocabulary:

```
movement axes, jump/crouch/sprint/fire/ADS bitfield, view angles,
sequence number, client timestamp
```

There is deliberately no position, velocity, hit claim, ammunition count, score
or match result in any client message. Look at
`packages/multiplayer-protocol/src/input.ts` — the absence is the design.

The server owns:

| Owned by the server                           |
| --------------------------------------------- |
| position and velocity, stance, grounded state |
| health and armour                             |
| weapon, ammunition, reload and fire cooldowns |
| projectiles, hits, damage, death              |
| respawn timing and spawn selection            |
| team assignment                               |
| score, match clock, match result              |

Note that the shot **origin** is derived from the server's own authoritative
position plus eye height — only the direction comes from the client's
(sanitised) view angles. A client cannot shoot from a place it is not standing.

## Connection flow

```
1. client  -> POST /api/v1/multiplayer/tickets      (HTTPS, session cookie)
              session check, ban check, protocol check, content check
2. api     -> mints a signed, single-use ticket; registers its id in Redis
3. api     -> returns wss://nightcell7.com/api/v1/multiplayer/sync/{region}/{shard}/{roomId}?ticket=...
4. client  -> connects to exactly that URL, nothing constructed locally
5. gateway -> forwards the upgrade to the private multiplayer service
6. room    -> verifies the signature, DELetes the Redis key (replay guard),
              re-checks the ban, then admits the player
```

The ticket expires in 30–60 seconds, is scoped to one account + room +
region/shard + protocol range, carries no session or payment credential, and is
redacted from every log.

## Prediction and reconciliation

Client and server run the **same** `stepMovement` from
`packages/multiplayer-sim`. The local player:

1. captures input with a monotonically increasing sequence number;
2. applies it immediately to the local prediction model;
3. sends it;
4. receives authoritative state plus the last processed sequence;
5. rewinds to the authoritative state and replays unacknowledged inputs;
6. smooths the residual visual error — unless it exceeds the snap threshold, in
   which case the correction is shown honestly rather than hidden.

Remote players are interpolated ~100 ms behind server time, with bounded
extrapolation through brief loss and a clear recovery beyond that.

`apps/game/src/net/prediction.test.ts` asserts that running the same inputs
through the predictor and through a real `MatchSimulation` produces the same
position. If that test fails, the netcode is broken.

## Anti-cheat posture

We do not claim cheat-proof operation, and there is no kernel-level anti-cheat.
What exists:

| Attack                               | Defence                                                          |
| ------------------------------------ | ---------------------------------------------------------------- |
| Claiming a position                  | Server simulates from input; positions are never accepted        |
| Claiming a hit                       | Server raycasts against its own historical capsules              |
| Speed hack via inflated `dtMs`       | `dtMs` clamped to 50 ms per frame                                |
| Speed hack via input flooding        | Per-tick movement-time budget (1.25 × tick); surplus frames wait |
| Replayed / reordered input           | Sequence must strictly increase; duplicates dropped and counted  |
| Memory exhaustion via input spam     | Pending buffer bounded per player                                |
| Inflated ping for a longer rewind    | Rewind clamped to 200 ms                                         |
| Firing faster than the weapon allows | Server owns `nextFireAtMs` and the magazine                      |
| Ticket replay                        | Single-use Redis key, consumed atomically                        |
| Ban evasion via private code         | Ban re-checked at ticket mint _and_ at join                      |
| Forged match result                  | Results signed by the match process; worker verifies             |
| Duplicate result                     | `resultHash` unique in the database and used as the job id       |

Malformed messages are counted per connection; a client producing a stream of
them is disconnected rather than allowed to burn tick budget.

## Rooms, shards and drain

V1 launches with one region and one certified shard. Capacity is established by
load test, never guessed. On SIGTERM a shard locks its rooms, gives in-flight
matches a bounded 90 s window, and ends anything still running with
`service_restart` — which is **not** counted as a win or a loss.

A match is owned by one process for its lifetime. There is no cross-process room
migration and no host migration in V1.

## Bots

Bots exist so the alpha is playable at low population, not to inflate numbers.
They produce `InputFrame`s and go through `queueInput` like any client, so they
are subject to identical validation, movement, fire cadence and ammunition. They
are labelled in the scoreboard, never consume a user account, are excluded from
profile statistics, and are replaced by humans at safe join points. Marketing
must never report bots as concurrent human players.

## Acceptance gates (PRD §18.13)

- [ ] A real mixed-platform 6v6 match completes through the canonical endpoint
- [ ] 12 clients receive consistent score, death, respawn and result state
- [x] Impossible movement/fire/ammo packets are rejected
- [x] A modified client cannot authoritatively claim a hit or score
- [x] Reconnect works within the grace window
- [x] Version mismatch produces a clear update path
- [x] A private code cannot bypass a ban or account verification
- [ ] Network load test establishes shard capacity
- [x] 50-match soak shows no unbounded memory growth (simulation harness)
- [ ] Deploy drain tested against a live shard
- [ ] Redis interruption behaviour verified
- [x] Match results persist exactly once
- [x] Browser, PWA and Electron share one production protocol
