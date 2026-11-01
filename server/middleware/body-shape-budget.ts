import type { Request, Response, NextFunction } from "express";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";

/**
 * Most values (objects, arrays and primitives, counted together) a parsed request
 * body may hold. The 2 MB size limit alone still admits ~1,000,000 one-character
 * array elements, and zod (3.x, and 4.x for arrays without `.max()`) builds one
 * issue object per failing element — ~350 MB of heap for a single request
 * (GHSA-mrhx-c7xc-m3w5). Real bodies are far smaller. The largest is a generated
 * meal plan (`/api/meal-plan/save-generated`, ≤50 meals): ~4,000 values with typical
 * recipes, ~13,000 with every capped list full and 30 ingredients per meal (its
 * ingredient list has no cap).
 */
export const MAX_BODY_VALUES = 20_000;

/**
 * Rejects a parsed body holding more than MAX_BODY_VALUES values with 413, before
 * any route validates it. Mount directly after the body parsers.
 */
export function bodyShapeBudget(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const body: unknown = req.body;
  if (body === null || typeof body !== "object") {
    next();
    return;
  }

  // Iterative walk (no recursion depth to exhaust). Children are counted from the
  // container's size BEFORE they are copied onto the stack, so a million-element
  // array is refused without first materialising a million stack entries.
  const stack: object[] = [body];
  let count = 1;
  while (stack.length > 0) {
    const value = stack.pop() as object;
    const size = Array.isArray(value)
      ? value.length
      : Object.keys(value).length;
    count += size;
    if (count > MAX_BODY_VALUES) {
      sendError(
        res,
        413,
        "Request body too large",
        ErrorCode.PAYLOAD_TOO_LARGE,
      );
      return;
    }
    for (const child of Object.values(value)) {
      if (child !== null && typeof child === "object") stack.push(child);
    }
  }
  next();
}
