/**
 * @nightcell7/multiplayer-sim
 *
 * Server-safe authoritative simulation. No Babylon, no DOM, no Electron, no
 * GPU (CLAUDE.md / PRD §18.3) — the same code runs in a Railway container, in
 * the browser as the client's prediction model, and in the test suite.
 */
export * from "./vec";
export * from "./constants";
export * from "./map";
export * from "./movement";
export * from "./hitscan";
export * from "./grenades";
export * from "./spawn";
export * from "./simulation";
export * from "./bots";
