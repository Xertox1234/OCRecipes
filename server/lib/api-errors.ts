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
): void {
  const body: Record<string, unknown> = { error };
  if (code) body.code = code;
  res.status(status).json(body);
}
