// scripts/mfa-reset.ts
/**
 * Manual two-step reset for an account holder who lost BOTH their phone and
 * their recovery codes. Runbook: docs/runbooks/mfa-manual-reset.md — verify the
 * person's identity first; never act on a request from a different address.
 *
 * Polarity: dry-run by DEFAULT — pass --commit (without --dry-run, which
 * vetoes it) to actually turn two-step verification off. Gated on the flag,
 * never on NODE_ENV (`railway run` does not set it).
 *
 * Usage:
 *   npx tsx scripts/mfa-reset.ts --user <id>             # dry run (default)
 *   npx tsx scripts/mfa-reset.ts --user <id> --commit    # actually reset
 */
import "dotenv/config";
import { storage } from "../server/storage";
import { sendTwoFactorNotice } from "../server/services/email";

export function parseArgs(argv: readonly string[]): {
  userId: string;
  dryRun: boolean;
} {
  const i = argv.indexOf("--user");
  const userId = i >= 0 ? argv[i + 1] : undefined;
  if (!userId || userId.startsWith("--")) {
    throw new Error(
      "Usage: npx tsx scripts/mfa-reset.ts --user <id> [--commit]",
    );
  }
  const dryRun = !argv.includes("--commit") || argv.includes("--dry-run");
  return { userId, dryRun };
}

// The stored hash can't show the password's length, so the script can't
// check it. It doesn't need to: with two-step off, sign-in refuses a full
// session to a password under 15 (needsPasswordUpgrade) until a longer one
// is chosen or two-step is turned back on.
const SHORT_PASSWORD_NOTE =
  "Note: if their password is shorter than 15 characters, their next sign-in will ask them to choose a longer one (or turn two-step back on) before signing them in. Tell them to expect it.";

export async function resetMfaForUser(
  userId: string,
  opts: { dryRun: boolean },
): Promise<"reset" | "not_enabled" | "no_user"> {
  const user = await storage.getUser(userId);
  if (!user) {
    console.log(`No user with id ${userId}. Nothing written.`);
    return "no_user";
  }
  console.log(
    `User ${user.username} — two-step verification on since: ${user.mfaEnabledAt?.toISOString() ?? "never (off)"}`,
  );
  if (user.mfaEnabledAt === null) {
    console.log("Two-step verification is already off. Nothing written.");
    return "not_enabled";
  }
  if (opts.dryRun) {
    console.log(
      "[DRY RUN] Would turn two-step verification off, cancel any pending email change, sign out every device and email the account. Re-run with --commit.",
    );
    console.log(SHORT_PASSWORD_NOTE);
    return "reset";
  }
  await storage.disableMfa(userId, { clearPendingEmail: true });
  await sendTwoFactorNotice(user.email, user.username, "disabled");
  console.log(
    "Done: two-step verification is off, any pending email change is cancelled, and every device is signed out (sessions already open can last up to 60 s more).",
  );
  console.log(SHORT_PASSWORD_NOTE);
  return "reset";
}

const isMain = (() => {
  try {
    return Boolean(process.argv[1]?.includes("mfa-reset"));
  } catch {
    return false;
  }
})();
if (isMain) {
  (async () => {
    const { userId, dryRun } = parseArgs(process.argv);
    await resetMfaForUser(userId, { dryRun });
    process.exit(0);
  })().catch((err) => {
    console.error("MFA reset failed:", err);
    process.exit(1);
  });
}
