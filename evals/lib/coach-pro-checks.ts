import { z } from "zod";
import type { CoachProShownReply } from "./coach-shown-reply";

/**
 * Deterministic checks on a Coach Pro turn (audit 2026-11-24, M30): which
 * tools ran with which arguments, which blocks and cards were shown. They
 * gate before the judge score does, which moves about +-0.3 at 3 samples.
 */
export const coachProChecksSchema = z.object({
  /** Each tool must be called at least once. */
  expectTools: z.array(z.string()).optional(),
  /** None of these tools may be called. */
  forbidTools: z.array(z.string()).optional(),
  /** tool -> argument -> regex its stringified value must match (case-insensitive). */
  toolArgs: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  expectBlocks: z.array(z.string()).optional(),
  forbidBlocks: z.array(z.string()).optional(),
  /** A write card of this kind must be proposed. */
  expectProposal: z.string().optional(),
  /** No write card may be proposed. */
  forbidProposal: z.boolean().optional(),
  /** true: offer_recipe must be called; false: it must not be. */
  expectOffer: z.boolean().optional(),
});
export type CoachProChecks = z.infer<typeof coachProChecksSchema>;

type Checked = Pick<
  CoachProShownReply,
  "toolCalls" | "blockTypes" | "proposals" | "offer"
>;

const list = (xs: string[]) => (xs.length ? xs.join(", ") : "none");

export function runCoachProChecks(
  reply: Checked,
  checks: CoachProChecks | undefined,
): string[] {
  if (!checks) return [];
  const failures: string[] = [];
  const called = reply.toolCalls.map((c) => c.name);
  const cards = reply.proposals.map((p) => p.kind);

  for (const t of checks.expectTools ?? []) {
    if (!called.includes(t)) {
      failures.push(`expected a ${t} call; calls: ${list(called)}`);
    }
  }
  for (const t of checks.forbidTools ?? []) {
    if (called.includes(t)) failures.push(`forbidden tool was called: ${t}`);
  }
  for (const [tool, fields] of Object.entries(checks.toolArgs ?? {})) {
    const call = reply.toolCalls.find((c) => c.name === tool);
    if (!call) {
      failures.push(`toolArgs: ${tool} was not called`);
      continue;
    }
    const args = (call.args ?? {}) as Record<string, unknown>;
    for (const [field, pattern] of Object.entries(fields)) {
      const value =
        typeof args[field] === "string"
          ? (args[field] as string)
          : JSON.stringify(args[field]);
      if (!new RegExp(pattern, "i").test(value ?? "")) {
        failures.push(
          `${tool}.${field} = ${JSON.stringify(value)} does not match /${pattern}/`,
        );
      }
    }
  }
  for (const b of checks.expectBlocks ?? []) {
    if (!reply.blockTypes.includes(b)) {
      failures.push(`expected a ${b} block; blocks: ${list(reply.blockTypes)}`);
    }
  }
  for (const b of checks.forbidBlocks ?? []) {
    if (reply.blockTypes.includes(b))
      failures.push(`forbidden block shown: ${b}`);
  }
  if (checks.expectProposal && !cards.includes(checks.expectProposal)) {
    failures.push(
      `expected a ${checks.expectProposal} card; cards: ${list(cards)}`,
    );
  }
  if (checks.forbidProposal && cards.length > 0) {
    failures.push(`expected no card; cards: ${list(cards)}`);
  }
  if (checks.expectOffer === true && reply.offer === undefined) {
    failures.push("expected an offer_recipe call");
  }
  if (checks.expectOffer === false && reply.offer !== undefined) {
    failures.push("offer_recipe was called but should not be");
  }
  return failures;
}
