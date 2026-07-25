/**
 * @nightcell7/multiplayer-protocol
 *
 * The single source of truth for what a client and a match server are allowed
 * to say to each other. Client, server, bots and load-test harness all import
 * from here, so a breaking change cannot land on one side only (PRD §17.4).
 *
 * `./ticket` is a separate, server-only entry point — it pulls in `node:crypto`
 * and must never reach a browser bundle.
 */
export * from "./version";
export * from "./codes";
export * from "./input";
export * from "./messages";
export * from "./state";
export * from "./results";
