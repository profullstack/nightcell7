import { describe, expect, it } from "vitest";
import { claimMessage, type ClaimState } from "./claim-state";

const STATES: ClaimState[] = [
  "claimable",
  "claimed_by_you",
  "claimed",
  "expired",
  "pending",
  "unavailable",
  "invalid",
];

describe("claim page copy", () => {
  it("has a heading and detail for every state, and no em dashes", () => {
    for (const state of STATES) {
      const message = claimMessage(state, "False Dawn");
      expect(message.heading.length, state).toBeGreaterThan(0);
      expect(message.detail.length, state).toBeGreaterThan(0);
      expect(`${message.heading} ${message.detail}`).not.toMatch(/—/);
    }
  });

  it("only calls the good states good", () => {
    const ok = STATES.filter((state) => claimMessage(state, "X").ok);
    expect(ok).toEqual(["claimable", "claimed_by_you"]);
  });

  it("names the episode where it matters", () => {
    expect(claimMessage("claimable", "False Dawn").heading).toContain("False Dawn");
    expect(claimMessage("claimed", "False Dawn").detail).toContain("False Dawn");
  });
});
