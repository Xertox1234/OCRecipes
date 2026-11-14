import type { z } from "zod";

/** Per-caller error/log strings, so each service keeps its own wording. */
export interface AiJsonMessages {
  /** Thrown when the model returned no content. */
  noResponse: string;
  /** Thrown when the content is not valid JSON (and on a schema miss, unless `schemaMismatch` is set). */
  invalid: string;
  /** Log message used when the JSON parses but fails the schema. */
  validationFailed: string;
  /** Optional separate thrown message for a schema miss; defaults to `invalid`. */
  schemaMismatch?: string;
}

/**
 * Parse and validate a model's JSON response: content-present → JSON.parse →
 * Zod safeParse → throw. Takes the raw content string (not an SDK response
 * object), so it is provider-neutral. Callers supply their own messages and
 * logger, which keeps every user-facing error string and log line unchanged.
 *
 * Throws a plain Error (never a ZodError): a schema miss is a model fault, and
 * handleRouteError would map a ZodError to a 400 client validation error.
 */
export function parseAiJson<T extends z.ZodTypeAny>(
  content: string | null | undefined,
  schema: T,
  msgs: AiJsonMessages,
  log: { warn: (obj: object, msg: string) => void },
): z.infer<T> {
  if (!content) {
    throw new Error(msgs.noResponse);
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(content);
  } catch {
    throw new Error(msgs.invalid);
  }

  const parsed = schema.safeParse(rawJson);
  if (!parsed.success) {
    log.warn({ zodErrors: parsed.error.flatten() }, msgs.validationFailed);
    throw new Error(msgs.schemaMismatch ?? msgs.invalid);
  }

  return parsed.data;
}
