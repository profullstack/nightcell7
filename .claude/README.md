# Agent workspace

Project rules for agents and contributors live in [`../CLAUDE.md`](../CLAUDE.md).

Before changing anything in `packages/multiplayer-protocol`,
`packages/multiplayer-sim` or `packages/game-core`, read
[`../docs/multiplayer.md`](../docs/multiplayer.md) — those packages carry the
guarantees the whole product rests on, and a change there is a protocol change.

Before touching payments, read [`../docs/coinpay/README.md`](../docs/coinpay/README.md).
CoinPayPortal is the only permitted processor.

Run `pnpm check` before proposing a change.
