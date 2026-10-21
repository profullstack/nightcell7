/**
 * What the claim page says for each state the API reports. Pure, so the copy
 * is tested and cannot drift from the states the API can return.
 */

export type ClaimState =
  "claimable" | "claimed_by_you" | "claimed" | "expired" | "pending" | "unavailable" | "invalid";

export interface ClaimMessage {
  ok: boolean;
  heading: string;
  detail: string;
}

export function claimMessage(state: ClaimState, title: string): ClaimMessage {
  switch (state) {
    case "claimable":
      return {
        ok: true,
        heading: `${title} is paid for.`,
        detail: "Attach it to an account and it is yours on every supported platform.",
      };
    case "claimed_by_you":
      return { ok: true, heading: "Already yours.", detail: `${title} is in your library.` };
    case "claimed":
      return {
        ok: false,
        heading: "This link has already been used.",
        detail: `${title} was claimed to an account. Each claim link works once.`,
      };
    case "expired":
      return {
        ok: false,
        heading: "This claim link has expired.",
        detail: "Links last 7 days. Your purchase is safe: we can email you a fresh one.",
      };
    case "pending":
      return {
        ok: false,
        heading: "Your payment is still confirming.",
        detail:
          "Crypto confirms when the network does, usually within minutes. Check again shortly.",
      };
    case "unavailable":
      return {
        ok: false,
        heading: "This order can no longer be claimed.",
        detail:
          "It was refunded, reversed or flagged for review. Contact support if that is wrong.",
      };
    case "invalid":
    default:
      return {
        ok: false,
        heading: "This claim link is not valid.",
        detail:
          "It may be incomplete. Copy the whole link from the email, or request a fresh one with the email you paid with.",
      };
  }
}
