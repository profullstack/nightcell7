# NIGHTCELL 7 on Steam: readiness and requirements

Status: **assessment, not a locked decision.** Written 2026-09-22 against
commit `HEAD` of `main` (last content commit 2026-08-03). This file records
what a Steam release would require, what already exists, and what blocks it.
When any decision below is taken, record it in `docs/prd.md` in the same
commit as the code (CLAUDE.md).

---

## 1. Summary

Getting a build onto Steam is the cheap part. The platform work is roughly
two to three weeks for one engineer. The game is not ready to be sold there,
and the repository already says so:

- Every play mode loads the one Ardavan Yard greybox. The seven campaign
  missions exist only as specs in `packages/game-core/src/campaign.ts`.
- The MoCap Online rifle animations on both operator models carry a licence
  marked **NOT CONFIRMED** in `apps/game/public/assets/PROVENANCE.md`, which
  states that it blocks commercial release.
- The narrative PRD (story bible, mission scripts, asset inventory) was never
  committed, so nobody can build the missions from what is checked in.

The realistic first step is a **free** Steam listing of the sandbox and the
6v6 Multiplayer Alpha under Early Access. Selling FALSE DAWN on Steam waits on
the campaign existing.

---

## 2. What Steam requires of us

| Requirement                | State                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------- |
| Legal entity, tax and bank | Profullstack, Inc. exists. Steamworks onboarding needs W-9 and bank details once.       |
| Steam Direct fee           | $100 per app, recouped once the app earns $1,000 adjusted gross.                        |
| Store page lead time       | Page must be public (Coming Soon) for at least two weeks before release.                |
| Review cycles              | Store page review and build review each take a few business days; plan for two rounds.  |
| Revenue share              | 30% to Valve on sales and DLC.                                                          |
| Store assets               | Header, small and main capsules, library capsule and hero, logo, 5+ screenshots.        |
| Trailer                    | Strongly recommended; the yard captures in `apps/site/public/media/yard/` are a start.  |
| Content questionnaire      | Violence in a fictional near-future Iran crisis. Expected to pass, may be region-gated. |
| AI disclosure              | Required. Valve's form counts code as well as art and audio; answer honestly.           |
| Third-party account        | Allowed but must be disclosed on the page if mandatory.                                 |
| Platforms                  | Windows only is acceptable. macOS and Linux builds are optional on Steam.               |
| Steam Deck                 | Electron titles generally verify; test once a bundled build exists.                     |

Nothing in the table is hard. All of it is forms, art and waiting.

---

## 3. Engineering gaps

Estimate: two to three weeks for one engineer, in this order.

### 3.1 Bundle the web build into the depot

`apps/desktop/src/main.ts` calls `loadURL` against `https://nightcell7.com/play/`.
The desktop app is a remote shell with no game on disk. A Steam depot must
contain the game: a shell that fetches the whole product from a website at
launch gives Valve nothing to review and fails offline.

- Copy the `apps/game` Vite output into the Electron package and load it from
  disk with `loadFile`.
- Keep `/api/v1/*` and the multiplayer WebSocket pointed at `nightcell7.com`.
  The gateway and API do not change.
- Keep the PRD §28.2 posture: no service worker, context isolation, sandbox,
  navigation allowlist.
- Version the bundled build against the API's handshake so a stale Steam
  build is refused with a machine-readable code, the same way multiplayer
  already refuses a stale client (PRD §18.5).

### 3.2 Sign in with Steam

Auth today is Better Auth with magic link and verified email (PRD §23). Steam
players are already signed in and will not tolerate an email round trip.

- Add `steamworks.js` to the desktop package and request a session ticket.
- Add `POST /api/v1/auth/steam` that verifies the ticket with the Steamworks
  Web API and creates or links an account. The Steam ID becomes a verified
  identity, which satisfies the multiplayer "verified account" rule.
- Keep magic link and passkey for the web. This is an additional identity,
  not a replacement.
- Disclose the account requirement on the store page (section 2).

### 3.3 Entitlements through Steam

Episodes sell for $9.99 through CoinPayPortal (PRD §24). Valve does not allow
a Steam-distributed app to sell content through an outside payment system.
Inside the Steam build the purchase must be Steam's.

- Ship the base app **free** and FALSE DAWN as a **Steam DLC** at $9.99.
- The API grants an entitlement when the Steamworks Web API confirms DLC
  ownership for the linked Steam ID. Refund on Steam revokes it, matching
  PRD §5.6.
- Hide the CoinPay checkout (`nightcell7:open-checkout`) in the Steam build.
  The web and direct-download builds keep CoinPay as the only processor.
- **Decision required:** `docs/prd.md` prohibits "a second payment processor"
  in V1. Steam DLC is one. Either amend that rule to "CoinPayPortal is the
  only direct processor; store platforms may sell the same episode under
  their own terms" or do not sell on Steam. Nothing below assumes the answer.

### 3.4 Store and build pipeline

- Produce the capsule set, screenshots and trailer.
- Upload builds with SteamPipe from the release workflow; add a `steam`
  target beside the existing electron-builder targets.
- Test the Steam overlay. It hooks the GPU and often fails under Electron.
  Failing is acceptable; crashing is not.
- Test pointer lock and fullscreen under Steam's launcher on Windows and Deck.

---

## 4. Content blockers

These are the actual gates. None of them is engineering.

| Blocker                       | Where it is recorded                                 | What clears it                                       |
| ----------------------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| One level                     | `apps/game/src/main.ts` builds `ARDAVAN_YARD` always | Playable demo missions for both sides (PRD §9)       |
| Campaign is data only         | `packages/game-core/src/campaign.ts`                 | Six mission variants over three locations (PRD §8)   |
| Animation licence unconfirmed | `apps/game/public/assets/PROVENANCE.md`              | Record MoCap Online's terms, or swap the three clips |
| Narrative PRD not in repo     | `docs/prd.md`, top note                              | Commit `docs/prd-v1.3.md`                            |

The animation clips are a command-line swap in
`tools/art/blender/retarget_mocap.py` once a licensed source exists. It is
the cheapest blocker and the only one that also gates the free listing.

---

## 5. Proposed path

1. **Clear the animation licence.** Required for any public Steam build,
   free or paid.
2. **Free Early Access listing** of the sandbox, benchmark, training and the
   Multiplayer Alpha. Sections 3.1, 3.2 and 3.4. No DLC yet, so the payment
   rule in section 3.3 stays untouched. Wishlists accrue while the campaign
   is built.
3. **Campaign.** Not scheduled anywhere in this repository. Steam gives one
   launch per app; the paid release should not go out on a greybox.
4. **DLC release** of FALSE DAWN once section 3.3's decision is taken and the
   demo and campaign exist.

---

## 6. Out of scope for a Steam release

- Steam Cloud saves. Local saves (PRD §19) are enough for V1; revisit if
  Deck play makes cross-device saves matter.
- Steam achievements, trading cards, workshop.
- Steam-hosted multiplayer. Matchmaking stays on Railway (PRD §18).
- Selling through any other store. This document covers Steam only.
