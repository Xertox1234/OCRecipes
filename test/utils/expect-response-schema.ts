/**
 * Provider-side contract assertion: the body a route actually produced must
 * satisfy the Zod schema the client parses it with. Plain `safeParse` is the
 * right strictness — extra server fields are not a drift risk for the client;
 * missing or mistyped ones are.
 *
 * Coverage of this helper is enforced by
 * scripts/__tests__/contract-coverage-guard.test.ts: every
 * `<name>Schema.safeParse(` / `.parse(` site under client/ needs a server test
 * that references the same schema name.
 */
import type { z } from "zod";

function formatPath(path: readonly (string | number)[]): string {
  if (path.length === 0) return "(root)";
  return path.reduce<string>((acc, seg) => {
    if (typeof seg === "number") return `${acc}[${seg}]`;
    return acc === "" ? seg : `${acc}.${seg}`;
  }, "");
}

export function expectResponseToMatch<T extends z.ZodTypeAny>(
  body: unknown,
  schema: T,
): z.infer<T> {
  const result = schema.safeParse(body);
  if (result.success) return result.data as z.infer<T>;
  const lines = result.error.issues.map(
    (issue) => `  ${formatPath(issue.path)}: ${issue.message}`,
  );
  throw new Error(`Response body does not match schema:\n${lines.join("\n")}`);
}
