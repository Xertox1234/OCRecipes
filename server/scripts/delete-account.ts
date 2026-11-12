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
 * Production (the internal database host does not resolve from a laptop):
 *   railway run --service Postgres -- sh -c \
 *     'DATABASE_URL="$DATABASE_PUBLIC_URL" npx tsx \
 *       server/scripts/delete-account.ts --email sam@example.com'
 *
 * Deleting an account does not cancel a store subscription; the person
 * cancels that in the App Store or Google Play.
 */
import "dotenv/config";
import { pool } from "../db";
import { storage } from "../storage";
import { deleteAccount } from "../services/account-deletion";

const USAGE = [
  "Usage:",
  "  delete-account (--email <address> | --username <name>)",
  "                 [--confirm-delete <account id>]",
  "Without --confirm-delete it only shows the account.",
].join("\n");

type Lookup = { by: "email" | "username"; value: string };

export type ParsedArgs =
  | { ok: true; lookup: Lookup; confirmId: string | undefined }
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
  return { ok: true, lookup, confirmId };
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

  if (args.confirmId === undefined) {
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

  await deps.deleteAccount(account, { awaitCleanup: true });
  deps.print("");
  deps.print(`Deleted account ${account.id}.`);
  return 0;
}

async function main() {
  const code = await runDeleteAccount(process.argv.slice(2), {
    findByEmail: storage.getUserByEmailForAuth,
    findByUsername: storage.getUserByUsernameForAuth,
    deleteAccount,
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
