import type { EvalTestCase, AssertionResult } from "./types";

/**
 * Run hard pass/fail assertions against a coach response.
 * mustNotRecommendBelow is intentionally NOT checked here —
 * it requires semantic understanding and is evaluated by the LLM judge.
 */
export function runAssertions(
  response: string,
  assertions: EvalTestCase["assertions"],
): AssertionResult {
  if (!assertions) return { passed: true, failures: [] };

  const failures: string[] = [];

  if (assertions.mustNotContain) {
    for (const pattern of assertions.mustNotContain) {
      const regex = new RegExp(pattern, "i");
      if (regex.test(response)) {
        failures.push(`Response contains forbidden pattern: "${pattern}"`);
      }
    }
  }

  if (assertions.mustContain) {
    for (const pattern of assertions.mustContain) {
      const regex = new RegExp(pattern, "i");
      if (!regex.test(response)) {
        failures.push(`Response missing required pattern: "${pattern}"`);
      }
    }
  }

  return { passed: failures.length === 0, failures };
}
