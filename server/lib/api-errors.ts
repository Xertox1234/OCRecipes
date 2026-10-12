import type { Response } from "express";

/**
 * Send a standardized error response.
 *
 * Standard shape: { error: string, code?: string }
 *
 * All API error responses must use this utility to ensure a consistent
 * shape across the entire backend.
 */
export function sendError(
  res: Response,
  status: number,
  error: string,
  code?: string,
  /** Extra fields that must ride along with the error. */
  extra?: Record<string, unknown>,
): void {
  const body: Record<string, unknown> = { ...extra, error };
  if (code) body.code = code;
  res.status(status).json(body);
}
