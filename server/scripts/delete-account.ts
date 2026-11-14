/* eslint-disable no-console */
/**
 * Delete one account by hand, for a deletion request that arrives by email
 * (ocrecipes.com/delete-account — privacy audit 2026-11-10, G7). It runs the
 * same `deleteAccount` the app's Delete Account button runs: Apple tokens
 * revoked, rows deleted, stored images removed.
 *
 * There is no password check here. Confirm the request really comes from the
 * account's owner BEFORE running this (a reply from the account's own email
 * address), and only the owner of the service runs it.
 *
 * Two steps, so a typo cannot delete the wrong account:
 *   1. Look:    npm run delete:account -- --email sam@example.com
 *               (or --username sam). Prints the account. Deletes nothing.
 *   2. Delete:  the same command plus --confirm-delete <the id step 1 printed>
 *
 * Production. The script needs the SERVER's settings, not only the database:
 * the image storage keys remove the pictures, and the Apple sign-in settings
 * revoke Apple's token. So it runs with the server service's variables, and
 * takes only the database address from the Postgres service (the server's own
 * address is an internal host that does not resolve from a laptop):
 *   DB="$(railway variable list --service Postgres --json \
 *         | jq -r .DATABASE_PUBLIC_URL)" \
 *   railway run --service OCRecipes -- sh -c \
 *     'DATABASE_URL="$DB" npx tsx \
 *       server/scripts/delete-account.ts --email sam@example.com'
 *
 * The delete step refuses to run where it could not finish the job (image
 * storage or Apple sign-in not set up), and says what is missing. On a
 * development database with nothing in storage, add --allow-incomplete.
 *
 * A phone that is signed in to the account can keep reading for up to a
 * minute afterwards: the running server caches each session check that long.
 *
 * Deleting an account does not cancel a store subscription; the person
 * cancels that in the App Store or Google Play.
 */
import "dotenv/config";
import { pool } from "../db";
import { storage } from "../storage";
import { deleteAccount } from "../services/account-deletion";
import { isR2Configured } from "../lib/image-store";
import { getSocialConfig } from "../lib/social-identity/config";

const USAGE = [
  "Usage:",
  "  delete-account (--email <address> | --username <name>)",
  "                 [--confirm-delete <account id>] [--allow-incomplete]",
  "Without --confirm-delete it only shows the account.",
  "--allow-incomplete deletes even where the pictures or the Apple sign-in",
  "cannot be removed (a development database only).",
].join("\n");

type Lookup = { by: "email" | "username"; value: string };

export type ParsedArgs =
  | {
      ok: true;
      lookup: Lookup;
      confirmId: string | undefined;
      allowIncomplete: boolean;
    }
  | { ok: false };

/** A flag's value: the next argument, unless that is another flag. */
function valueOf(argv: string[], flag: string): string | undefined | null {
  const at = argv.indexOf(flag);
  if (at === -1) return undefined;
  const value = argv[at + 1];
  return value && !value.startsWith("--") ? value : null;
}

export function parseDeleteAccountArgs(argv: string[]): ParsedArgs {
  const email = valueOf(argv, "--email");
  const username = valueOf(argv, "--username");
  const confirmId = valueOf(argv, "--confirm-delete");
  // null = the flag was given without a value.
  if (email === null || username === null || confirmId === null) {
    return { ok: false };
  }
  // Exactly one way to find the account.
  if ((email === undefined) === (username === undefined)) return { ok: false };
  const lookup: Lookup = email
    ? { by: "email", value: email }
    : { by: "username", value: username as string };
  return {
    ok: true,
    lookup,
    confirmId,
    allowIncomplete: argv.includes("--allow-incomplete"),
  };
}

/**
 * What `deleteAccount` would leave behind in this environment. Both steps are
 * best-effort inside it (a missing setting is skipped, not an error), which
 * suits the running server, where the settings are checked at boot. Run by
 * hand, the settings are whatever the command line supplied.
 */
export function findCleanupGaps(): string[] {
  const gaps: string[] = [];
  if (!isR2Configured()) {
    gaps.push(
      "stored pictures stay in storage (the R2_* variables are not all set)",
    );
  }
  if (!getSocialConfig().apple) {
    gaps.push(
      "Apple sign-in stays authorised (APPLE_TEAM_ID, APPLE_SIGN_IN_KEY_ID, " +
        "APPLE_SIGN_IN_PRIVATE_KEY, APPLE_BUNDLE_ID and IDENTITY_TOKEN_ENC_KEY " +
        "are not all set)",
    );
  }
  return gaps;
}

interface FoundAccount {
  id: string;
  username: string;
  email: string | null;
  avatarUrl: string | null;
  createdAt: Date | null;
  subscriptionTier: string | null;
}

export interface DeleteAccountDeps {
  findByEmail: (email: string) => Promise<FoundAccount | undefined>;
  findByUsername: (username: string) => Promise<FoundAccount | undefined>;
  deleteAccount: (
    user: FoundAccount,
    options: { awaitCleanup: boolean },
  ) => Promise<void>;
  /** What a deletion run here would leave behind; empty when nothing. */
  cleanupGaps: () => string[];
  print: (line: string) => void;
}

/** Returns the process exit code. */
export async function runDeleteAccount(
  argv: string[],
  deps: DeleteAccountDeps,
): Promise<number> {
  const args = parseDeleteAccountArgs(argv);
  if (!args.ok) {
    deps.print(USAGE);
    return 1;
  }

  const account =
    args.lookup.by === "email"
      ? await deps.findByEmail(args.lookup.value)
      : await deps.findByUsername(args.lookup.value);
  if (!account) {
    deps.print(`No account with that ${args.lookup.by}. Nothing was deleted.`);
    return 1;
  }

  deps.print(`Account id: ${account.id}`);
  deps.print(`Username:   ${account.username}`);
  deps.print(`Email:      ${account.email ?? "(none)"}`);
  deps.print(`Created:    ${account.createdAt?.toISOString() ?? "(unknown)"}`);
  if (account.subscriptionTier && account.subscriptionTier !== "free") {
    deps.print(
      `Plan:       ${account.subscriptionTier} — deleting does NOT cancel a ` +
        "store subscription; tell the person to cancel it in the App Store or Google Play.",
    );
  }

  const gaps = deps.cleanupGaps();
  const printGaps = (heading: string) => {
    deps.print("");
    deps.print(heading);
    for (const gap of gaps) deps.print(`  - ${gap}`);
  };

  if (args.confirmId === undefined) {
    if (gaps.length > 0) {
      printGaps("This environment cannot finish a deletion:");
    }
    deps.print("");
    deps.print("Nothing was deleted. To delete this account, run again with:");
    deps.print(`  --confirm-delete ${account.id}`);
    return 0;
  }
  if (args.confirmId !== account.id) {
    deps.print("");
    deps.print(
      "--confirm-delete does not match this account's id. Nothing was deleted.",
    );
    return 1;
  }
  if (gaps.length > 0 && !args.allowIncomplete) {
    printGaps("This environment cannot finish the deletion:");
    deps.print("");
    deps.print(
      "Nothing was deleted. Run it with the server's settings (see the top " +
        "of this file), or add --allow-incomplete on a development database.",
    );
    return 1;
  }

  await deps.deleteAccount(account, { awaitCleanup: true });
  deps.print("");
  deps.print(`Deleted account ${account.id}.`);
  if (gaps.length > 0) printGaps("Left behind:");
  return 0;
}

async function main() {
  const code = await runDeleteAccount(process.argv.slice(2), {
    findByEmail: storage.getUserByEmailForAuth,
    findByUsername: storage.getUserByUsernameForAuth,
    deleteAccount,
    cleanupGaps: findCleanupGaps,
    print: (line) => console.log(line),
  });
  await pool.end();
  process.exit(code);
}

// Run only when started directly, never when a test imports this file.
if (process.argv[1]?.includes("delete-account")) {
  main().catch((err) => {
    console.error("delete-account failed:", err);
    void pool.end().then(() => process.exit(1));
  });
}
