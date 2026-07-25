/**
 * @nightcell7/entitlements
 *
 * Order lifecycle, catalog pricing and entitlement rules. Payment-provider
 * agnostic by design: CoinPayPortal specifics live in `@nightcell7/coinpay`,
 * so the rules that decide what a player owns stay testable without a provider.
 */
export * from "./orders";
export * from "./entitlements";
export * from "./catalog";
