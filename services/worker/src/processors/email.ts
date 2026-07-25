import { Resend } from "resend";
import type { Logger } from "@nightcell7/observability";

/**
 * Transactional email (PRD §17.1).
 *
 * Only the messages V1 actually needs. Marketing email is a separate,
 * consented list and never rides on this path.
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
      const { subject, text } = renderEmail(job);
      const response = await resend.emails.send({ from, to: job.to, subject, text });
      if (response.error) {
        // Surfacing the failure lets BullMQ retry rather than silently dropping
        // a claim link the buyer is waiting for.
        throw new Error(`resend failed: ${response.error.message}`);
      }
      logger.info("email sent", { kind: job.kind });
    },
  };
}

export function renderEmail(job: EmailJob): { subject: string; text: string } {
  switch (job.kind) {
    case "verify-email":
      return {
        subject: "Verify your NIGHTCELL 7 account",
        text: `Verify your email to enable multiplayer and your library:\n\n${job.verifyUrl}\n\nIf you did not create this account, ignore this message.`,
      };
    case "password-reset":
      return {
        subject: "Reset your NIGHTCELL 7 password",
        text: `Reset your password:\n\n${job.resetUrl}\n\nThis link expires shortly. If you did not request it, ignore this message.`,
      };
    case "purchase-claim":
      return {
        subject: `Claim ${job.episodeTitle}`,
        text: `Thank you for buying ${job.episodeTitle}.\n\nClaim it to your account here:\n\n${job.claimUrl}\n\nThis link works once. Your purchase includes both campaigns, the Complete Truth epilogue, and every supported platform.`,
      };
    case "purchase-receipt":
      return {
        subject: `Your NIGHTCELL 7 receipt — ${job.episodeTitle}`,
        text: `Order ${job.orderId}\n${job.episodeTitle} — ${job.total}\n\nPaid through CoinPayPortal. Both campaigns and the Complete Truth epilogue are now in your library on every supported platform.`,
      };
    case "entitlement-revoked":
      return {
        subject: `Access to ${job.episodeTitle} has been removed`,
        text: `Access to ${job.episodeTitle} was removed (${job.reason}).\n\nFree multiplayer and the demo remain available. If you believe this is a mistake, reply to open a support ticket.`,
      };
  }
}
