import { Resend } from "resend";
import type { Logger } from "@nightcell7/observability";

/**
 * Transactional email (PRD §17.1).
 *
 * Only the messages V1 actually needs. Marketing email is a separate, consented
 * list and never rides on this path.
 *
 * Every message ships HTML *and* plain text. A verification link that only
 * renders in an HTML client is a support ticket waiting to happen, and some
 * clients strip HTML entirely.
 */

export type EmailJob =
  | { kind: "verify-email"; to: string; verifyUrl: string }
  | { kind: "password-reset"; to: string; resetUrl: string }
  | { kind: "purchase-claim"; to: string; claimUrl: string; episodeTitle: string }
  | { kind: "purchase-receipt"; to: string; episodeTitle: string; orderId: string; total: string }
  | { kind: "entitlement-revoked"; to: string; episodeTitle: string; reason: string };

export interface EmailSender {
  send(job: EmailJob): Promise<void>;
}

export function createResendSender(apiKey: string, from: string, logger: Logger): EmailSender {
  const resend = new Resend(apiKey);

  return {
    async send(job) {
      const { subject, text, html } = renderEmail(job);
      const response = await resend.emails.send({ from, to: job.to, subject, text, html });
      if (response.error) {
        // Surfacing the failure lets BullMQ retry rather than silently dropping
        // a verification link the user is waiting for.
        throw new Error(`resend failed: ${response.error.message}`);
      }
      logger.info("email sent", { kind: job.kind });
    },
  };
}

// --------------------------------------------------------------------------
// Branding
// --------------------------------------------------------------------------

/**
 * Inline styles only.
 *
 * Email clients strip <style> blocks and have no CSS custom properties, so the
 * DIVIDED SIGNAL palette (PRD §21.3) is repeated literally here rather than
 * imported from @nightcell7/ui.
 */
const INK_950 = "#07090c";
const INK_900 = "#0d1116";
const BONE_100 = "#ece8df";
const BONE_300 = "#c6c1b7";
const SIGNAL_RED = "#d33a3f";
const DUST_GOLD = "#ad9365";

const SITE = "https://nightcell7.com";

interface Block {
  heading: string;
  body: string[];
  action?: { label: string; url: string };
  /** Shown small, under the button. */
  footnote?: string;
}

function layout(block: Block): string {
  const paragraphs = block.body
    .map(
      (line) =>
        `<p style="margin:0 0 16px;color:${BONE_300};font-size:15px;line-height:1.65;">${line}</p>`,
    )
    .join("");

  const button = block.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0;">
         <tr><td style="background:${BONE_100};border-radius:2px;">
           <a href="${block.action.url}"
              style="display:inline-block;padding:14px 28px;color:${INK_950};text-decoration:none;
                     font-family:'Barlow Condensed',Arial,sans-serif;font-size:16px;
                     letter-spacing:.14em;text-transform:uppercase;font-weight:600;">
             ${block.action.label}
           </a>
         </td></tr>
       </table>
       <p style="margin:0 0 8px;color:${BONE_300};font-size:12px;line-height:1.6;">
         Or paste this into your browser:<br>
         <a href="${block.action.url}" style="color:${DUST_GOLD};word-break:break-all;">${block.action.url}</a>
       </p>`
    : "";

  const footnote = block.footnote
    ? `<p style="margin:16px 0 0;color:#8b877f;font-size:12px;line-height:1.6;">${block.footnote}</p>`
    : "";

  return `<!doctype html>
<html lang="en"><body style="margin:0;padding:0;background:${INK_950};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${INK_950};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:560px;background:${INK_900};border:1px solid #232a32;">

        <!-- The divided signal: red and cyan either side of a hairline. -->
        <tr><td style="height:3px;background:linear-gradient(90deg,${SIGNAL_RED} 0%,#232a32 50%,#54bdca 100%);"></td></tr>

        <tr><td style="padding:32px 32px 8px;">
          <p style="margin:0;font-family:'Barlow Condensed',Arial,sans-serif;font-size:18px;
                    letter-spacing:.24em;color:${BONE_100};text-transform:uppercase;">
            NIGHTCELL <span style="color:${SIGNAL_RED};">7</span>
          </p>
          <p style="margin:4px 0 0;font-size:11px;letter-spacing:.2em;color:${DUST_GOLD};text-transform:uppercase;">
            False Dawn
          </p>
        </td></tr>

        <tr><td style="padding:16px 32px 32px;">
          <h1 style="margin:0 0 16px;font-family:'Barlow Condensed',Arial,sans-serif;
                     font-size:26px;line-height:1.15;color:${BONE_100};text-transform:uppercase;
                     letter-spacing:.02em;">${block.heading}</h1>
          ${paragraphs}
          ${button}
          ${footnote}
        </td></tr>

        <tr><td style="padding:20px 32px;border-top:1px solid #232a32;">
          <p style="margin:0;color:#8b877f;font-size:11px;line-height:1.7;">
            <a href="${SITE}" style="color:${BONE_300};text-decoration:none;">nightcell7.com</a>
            &nbsp;&middot;&nbsp;
            <a href="${SITE}/support" style="color:${BONE_300};text-decoration:none;">Support</a>
            &nbsp;&middot;&nbsp;
            <a href="${SITE}/privacy" style="color:${BONE_300};text-decoration:none;">Privacy</a>
          </p>
          <p style="margin:12px 0 0;color:#6d6a64;font-size:11px;line-height:1.6;">
            NIGHTCELL 7 is a fictional work set in an invented near-future crisis. Its
            organizations, facilities, operations and characters are fictional.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function renderEmail(job: EmailJob): { subject: string; text: string; html: string } {
  switch (job.kind) {
    case "verify-email":
      return {
        subject: "Verify your NIGHTCELL 7 account",
        text: `Verify your email to enable multiplayer and your library:\n\n${job.verifyUrl}\n\nThe link expires in 24 hours. If you did not create this account, ignore this message.`,
        html: layout({
          heading: "Verify your email",
          body: [
            "One click and your account is live. Verification is what makes bans, reports and match records mean something &mdash; it is not a paywall.",
            "The demo needs no account at all, and multiplayer is free once you are verified.",
          ],
          action: { label: "Verify email", url: job.verifyUrl },
          footnote:
            "This link expires in 24 hours. If you did not create this account, ignore this message and nothing happens.",
        }),
      };

    case "password-reset":
      return {
        subject: "Reset your NIGHTCELL 7 password",
        text: `Reset your password:\n\n${job.resetUrl}\n\nThis link expires shortly and works once. If you did not request it, ignore this message.`,
        html: layout({
          heading: "Reset your password",
          body: ["Set a new password with the link below."],
          action: { label: "Set new password", url: job.resetUrl },
          footnote:
            "Works once and expires shortly. If you did not request this, ignore it — your password is unchanged.",
        }),
      };

    case "purchase-claim":
      return {
        subject: `Claim ${job.episodeTitle}`,
        text: `Thank you for buying ${job.episodeTitle}.\n\nClaim it to your account:\n\n${job.claimUrl}\n\nThis link works once. Your purchase includes both campaigns, the Complete Truth epilogue, and every supported platform.`,
        html: layout({
          heading: `Claim ${job.episodeTitle}`,
          body: [
            "Thank you for your purchase. Claim it to an account and it is yours on every supported platform.",
            "Your purchase includes both campaigns and the Complete Truth epilogue.",
          ],
          action: { label: "Claim your episode", url: job.claimUrl },
          footnote:
            "This link works once. Keep it private — anyone with it can claim the purchase.",
        }),
      };

    case "purchase-receipt":
      return {
        subject: `Your NIGHTCELL 7 receipt — ${job.episodeTitle}`,
        text: `Order ${job.orderId}\n${job.episodeTitle} — ${job.total}\n\nPaid through CoinPayPortal. Both campaigns and the Complete Truth epilogue are now in your library on every supported platform.`,
        html: layout({
          heading: "Receipt",
          body: [
            `<strong style="color:${BONE_100};">${job.episodeTitle}</strong> &mdash; ${job.total}`,
            `Order <span style="font-family:monospace;">${job.orderId}</span>, paid through CoinPayPortal.`,
            "Both campaigns and the Complete Truth epilogue are in your library now, on every supported platform.",
          ],
          action: { label: "Open your library", url: `${SITE}/library` },
        }),
      };

    case "entitlement-revoked":
      return {
        subject: `Access to ${job.episodeTitle} has been removed`,
        text: `Access to ${job.episodeTitle} was removed (${job.reason}).\n\nFree multiplayer and the demo remain available. If you believe this is a mistake, reply to open a support ticket.`,
        html: layout({
          heading: "Access removed",
          body: [
            `Access to <strong style="color:${BONE_100};">${job.episodeTitle}</strong> was removed (${job.reason}).`,
            "Free multiplayer and the demo are unaffected, and your account is intact.",
          ],
          action: { label: "Contact support", url: `${SITE}/support` },
          footnote: "If you believe this is a mistake, support can look up exactly what happened.",
        }),
      };
  }
}
