import bcrypt from "bcrypt";
import { isLegacyHash, preHash, PASSWORD_HASH_PREFIX } from "./password-hash";

// Fixed cost-12 bcrypt hash compared against on the missing-user login branch
// (and for a NULL password) so "no such user" / "social-only account" cost the
// same ~250ms as "wrong password". The plaintext is irrelevant and matches
// nothing real.
export const DUMMY_PASSWORD_HASH =
  "$2b$12$Dr3GzjhqTPluaG3QtTffX.SA5LiZi/05bbk8i97iK0z0QygBxFIgy";

/**
 * One bcrypt compare, always. A NULL hash (an account created through
 * Google/Apple that never set a password) is `false` — never a throw, never a
 * fast path.
 */
export async function passwordMatches(
  input: string,
  hash: string | null,
): Promise<boolean> {
  if (hash === null) {
    await bcrypt.compare(input, DUMMY_PASSWORD_HASH);
    return false;
  }
  if (isLegacyHash(hash)) return bcrypt.compare(input, hash);
  return bcrypt.compare(
    preHash(input),
    hash.slice(PASSWORD_HASH_PREFIX.length),
  );
}
