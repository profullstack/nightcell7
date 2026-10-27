import { describe, expect, it } from "vitest";
import { Credits, memoryStore as creditMemory } from "@profullstack/redeem-credits";
import { Affiliates, memoryStore as affMemory } from "@profullstack/affiliates";
import {
  DEFAULT_EPISODE_UNIT,
  acceptInvite,
  mailboxKey,
  redeemCode,
  type CreditsDeps,
} from "./credits";

const DAY = 86_400_000;

function fakeDeps(accounts: Record<string, { email: string; ageDays?: number }>) {
  const owned = new Map<string, string>();
  const deps: CreditsDeps = {
    credits: new Credits(creditMemory()),
    affiliates: new Affiliates(affMemory(), { defaultQuota: 3 }),
    async ownsEpisode(userId, episodeId) {
      return owned.has(`${userId}:${episodeId}`);
    },
    async grantEpisode(userId, episodeId, actor) {
      const key = `${userId}:${episodeId}`;
      if (owned.has(key)) return false;
      owned.set(key, actor);
      return true;
    },
    async accountInfo(userId) {
      const a = accounts[userId];
      return a
        ? { email: a.email, createdAt: new Date(Date.now() - (a.ageDays ?? 0) * DAY) }
        : null;
    },
    async emailsOnDomains(domains, excludeUserId) {
      return Object.entries(accounts)
        .filter(
          ([id, a]) =>
            id !== excludeUserId && domains.includes(a.email.split("@")[1]!.toLowerCase()),
        )
        .map(([, a]) => a.email);
    },
  };
  return { deps, owned };
}

describe("gift codes", () => {
  it("grants the episode once; a second redeem and an owner are refused without spending", async () => {
    const { deps, owned } = fakeDeps({
      u_a: { email: "a@example.com" },
      u_b: { email: "b@example.com" },
    });
    const { code } = await deps.credits.mint({
      grant: { unit: DEFAULT_EPISODE_UNIT, amount: 1 },
      maxRedemptions: 2,
    });

    const first = await redeemCode(deps, "u_a", code);
    expect(first).toEqual({ ok: true, episodeId: "false-dawn", granted: true });
    expect(owned.get("u_a:false-dawn")).toMatch(/^code:crd_/);

    const owner = await redeemCode(deps, "u_a", code);
    expect(owner.ok).toBe(false);
    expect(owner.ok ? "" : owner.reason).toBe("already_owned");
    // the owner's attempt did not use the second redemption
    expect((await deps.credits.list())[0]!.redemptions).toBe(1);
    expect((await redeemCode(deps, "u_b", code)).ok).toBe(true);

    const bad = await redeemCode(deps, "u_c", "NC7-0000-0000-0000-0000");
    expect(bad.ok ? "" : bad.reason).toBe("invalid");
  });

  it("a single-use code goes to one account", async () => {
    const { deps } = fakeDeps({});
    const { code } = await deps.credits.mint({ grant: { unit: DEFAULT_EPISODE_UNIT, amount: 1 } });
    expect((await redeemCode(deps, "u_x", code)).ok).toBe(true);
    const r = await redeemCode(deps, "u_y", code);
    expect(r.ok ? "" : r.reason).toBe("used_up");
  });
});

describe("invites", () => {
  const accounts = {
    u_inv1: { email: "one@example.com", ageDays: 30 },
    u_inv2: { email: "two@example.com", ageDays: 30 },
    u_new: { email: "new@example.com" },
    u_old: { email: "old@example.com", ageDays: 8 },
    u_throw: { email: "x@mailinator.com" },
    u_gm: { email: "jane.doe@gmail.com", ageDays: 30 },
    u_gm2: { email: "janedoe+x@googlemail.com" },
  };

  it("concurrent double-accept: one wins, the other is already_invited and stays unused", async () => {
    const { deps } = fakeDeps(accounts);
    const a = await deps.affiliates.createInvite("u_inv1");
    const b = await deps.affiliates.createInvite("u_inv2");
    const results = await Promise.all([
      acceptInvite(deps, { userId: "u_new", verified: true }, a.code),
      acceptInvite(deps, { userId: "u_new", verified: true }, b.code),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const lost = results.find((r) => !r.ok);
    expect(lost && !lost.ok ? lost.reason : "").toBe("already_invited");
    const winner = results[0]!.ok ? "u_inv1" : "u_inv2";
    const loser = winner === "u_inv1" ? "u_inv2" : "u_inv1";
    expect(await deps.affiliates.invitedBy("u_new")).toBe(winner);
    expect((await deps.affiliates.invites(loser))[0]!.usedBy).toBeNull();
  });

  it("gates: unverified, old, throwaway, alias, self; none of them burn the invite", async () => {
    const { deps } = fakeDeps(accounts);
    const inv = await deps.affiliates.createInvite("u_inv1");
    const reason = async (userId: string, verified = true) => {
      const r = await acceptInvite(deps, { userId, verified }, inv.code);
      return r.ok ? "ok" : r.reason;
    };
    expect(await reason("u_new", false)).toBe("not_verified");
    expect(await reason("u_old")).toBe("account_too_old");
    expect(await reason("u_throw")).toBe("throwaway_email");
    expect(await reason("u_gm2")).toBe("duplicate_account");
    expect(await reason("u_inv1")).toBe("account_too_old");
    expect((await deps.affiliates.invites("u_inv1"))[0]!.usedBy).toBeNull();
    expect(await reason("u_new")).toBe("ok");
  });

  it("mailboxKey folds +tags and Gmail dots", () => {
    expect(mailboxKey("J.Doe+x@GoogleMail.com")).toBe("jdoe@gmail.com");
    expect(mailboxKey("a.b+c@example.com")).toBe("a.b@example.com");
  });
});
