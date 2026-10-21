import { describe, expect, it } from "vitest";
import { displayNameSchema } from "./index";
import { defaultDisplayName } from "./server";

describe("display name for a magic link or passkey signup", () => {
  it("derives a valid, suffixed name from the email", () => {
    const name = defaultDisplayName("leila.k@example.com", () => 0.1234);
    expect(name).toBe("leila.k-1234");
    expect(displayNameSchema.safeParse(name).success).toBe(true);
  });

  it("stays valid for awkward addresses", () => {
    for (const email of [
      "+++@example.com",
      "a@example.com",
      "_under@example.com",
      "very.long.local.part.indeed.yes@example.com",
      "émile@example.com",
    ]) {
      const name = defaultDisplayName(email, () => 0.5);
      expect(displayNameSchema.safeParse(name).success, `${email} -> ${name}`).toBe(true);
    }
  });
});
