import { type User, users } from "@shared/schema";
import { getTableColumns } from "drizzle-orm";

// Column picks shared by users.ts and user-email.ts (moved out of users.ts,
// pure move). DB-free on purpose: no `db` import.

// Exclude password AND the password-reset columns from default queries —
// defense-in-depth against accidental leaks. Only the *ForAuth getters return
// the password hash. The REAL guard for HTTP responses is response shaping
// (serializeUser / explicit picks in routes); full-row paths (createUser,
// updateUser .returning(), *ForAuth) still carry these columns — never strip
// them here instead of shaping the response.
const {
  password: _password,
  resetCodeHash: _resetCodeHash,
  resetCodeExpiresAt: _resetCodeExpiresAt,
  resetCodeAttempts: _resetCodeAttempts,
  resetIssueCount: _resetIssueCount,
  resetIssueWindowStart: _resetIssueWindowStart,
  ...safeUserColumns
} = getTableColumns(users);

type ResetColumnKey =
  | "resetCodeHash"
  | "resetCodeExpiresAt"
  | "resetCodeAttempts"
  | "resetIssueCount"
  | "resetIssueWindowStart";

/** User row without password hash or password-reset state */
export type SafeUser = Omit<User, "password" | ResetColumnKey>;

export { safeUserColumns };
