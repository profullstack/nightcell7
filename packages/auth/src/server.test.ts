import { describe, expect, it } from "vitest";
import { displayNameSchema } from "./index";
import { defaultDisplayName, stripOAuthTokens } from "./server";

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

describe("social-login provider tokens are never persisted", () => {
  it("nulls access, refresh and id tokens and their expiry", () => {
    const out = stripOAuthTokens({
      providerId: "github",
      accountId: "123",
      userId: "u1",
      accessToken: "gho_x",
      refreshToken: "ghr_x",
      idToken: "eyJ.x.y",
      accessTokenExpiresAt: new Date(),
      refreshTokenExpiresAt: new Date(),
      scope: "read:user",
    });
    expect(out).toEqual({
      providerId: "github",
      accountId: "123",
      userId: "u1",
      accessToken: null,
      refreshToken: null,
      idToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      scope: "read:user",
    });
  });

  it("leaves a credential account (password hash) alone and adds no token keys", () => {
    const account = { providerId: "credential", accountId: "u1", userId: "u1", password: "salt:hash" };
    expect(stripOAuthTokens(account)).toEqual(account);
  });

  it("does not mutate its input", () => {
    const account = { providerId: "google", refreshToken: "r" };
    stripOAuthTokens(account);
    expect(account.refreshToken).toBe("r");
  });
});
