import type { EvalTestCase, AssertionResult } from "./types";

/**
 * Safely compile a regex pattern. Returns `null` on invalid regex (catches
 * ReDoS / syntax errors at compile time). Callers fail the assertion — not
 * the whole eval run — when compilation fails so one malformed test case
 * can't take down the suite.
 */
function safeCompile(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "i");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `    ⚠ Invalid assertion regex "${pattern}": ${message}; failing assertion`,
    );
    return null;
  }
}

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
      const regex = safeCompile(pattern);
      if (!regex) {
        failures.push(`Invalid mustNotContain regex: "${pattern}"`);
        continue;
      }
      if (regex.test(response)) {
        failures.push(`Response contains forbidden pattern: "${pattern}"`);
      }
    }
  }

  if (assertions.mustContain) {
    for (const pattern of assertions.mustContain) {
      const regex = safeCompile(pattern);
      if (!regex) {
        failures.push(`Invalid mustContain regex: "${pattern}"`);
        continue;
      }
      if (!regex.test(response)) {
        failures.push(`Response missing required pattern: "${pattern}"`);
      }
    }
  }

  return { passed: failures.length === 0, failures };
}
