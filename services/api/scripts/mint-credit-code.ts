#!/usr/bin/env bun
// Mint a NIGHTCELL 7 gift code: one code = Episode 1 (False Dawn) for one account.
// Staff only; there is no minting route.
//
//   docker exec -w /app/services/api nightcell7com-app-1 bun scripts/mint-credit-code.ts [--max 1] [--expires-days 90] [--label "for X"]
//   ... --list             every code (hashes only; codes are never stored)
//   ... --revoke crd_...   revoke one
//
// The code is printed once.
import pg from "pg";
import { Credits, postgresStore } from "@profullstack/redeem-credits";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const credits = new Credits(postgresStore(pool));
try {
  if (args.includes("--list")) {
    for (const c of await credits.list())
      console.log(
        `${c.id}\t${c.grant.unit}\t${c.redemptions}/${c.maxRedemptions}\t${c.revokedAt ? "revoked" : "live"}\t${c.label}`,
      );
  } else if (opt("revoke")) {
    await credits.revoke(opt("revoke")!);
    console.log("revoked");
  } else {
    const expires = Number(opt("expires-days") ?? 0);
    const m = await credits.mint({
      grant: { unit: "episode:false-dawn", amount: 1 },
      maxRedemptions: Number(opt("max") ?? 1),
      expiresAt: expires ? Date.now() + expires * 86_400_000 : null,
      label: opt("label") ?? "",
      prefix: "NC7",
      createdBy: "staff-script",
    });
    console.log(
      JSON.stringify({ code: m.code, id: m.id, max: m.maxRedemptions, expires_at: m.expiresAt }),
    );
  }
} finally {
  await pool.end();
}
