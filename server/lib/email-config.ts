/**
 * Single source of truth for "is email verification enforced?".
 * Read live (not cached at module load) so tests can toggle it via stubEnv and
 * so a deploy can flip the gate by setting RESEND_API_KEY without a code change.
 * Placed in lib/ (lowest layer) so middleware AND services may import it.
 */
export function emailVerificationEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}
