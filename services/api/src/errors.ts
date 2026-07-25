import type { Context } from "hono";
import { z } from "zod";

/**
 * One error shape for the whole API (PRD §29.2).
 *
 * Clients — including the game's update-required flow — branch on `code`, never
 * on a human-readable message, so codes are part of the public contract.
 */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** Field-level detail for validation failures. */
    fields?: Record<string, string>;
    correlationId?: string;
  };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (code: string, message: string, fields?: Record<string, string>) =>
  new ApiError(400, code, message, fields);
export const unauthorized = (message = "Sign in to continue.") =>
  new ApiError(401, "unauthorized", message);
export const forbidden = (code: string, message: string) => new ApiError(403, code, message);
export const notFound = (code = "not_found", message = "Not found.") =>
  new ApiError(404, code, message);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);
export const tooManyRequests = (message = "Slow down.") =>
  new ApiError(429, "rate_limited", message);

export function errorResponse(c: Context, error: unknown, correlationId?: string) {
  if (error instanceof ApiError) {
    const body: ApiErrorBody = {
      error: {
        code: error.code,
        message: error.message,
        fields: error.fields,
        correlationId,
      },
    };
    return c.json(body, error.status as 400);
  }

  if (error instanceof z.ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of error.issues) fields[issue.path.join(".")] = issue.message;
    const body: ApiErrorBody = {
      error: { code: "validation_failed", message: "Invalid request.", fields, correlationId },
    };
    return c.json(body, 400);
  }

  // Never leak an internal message or stack to the client (PRD §29.2).
  const body: ApiErrorBody = {
    error: { code: "internal_error", message: "Something went wrong.", correlationId },
  };
  return c.json(body, 500);
}
