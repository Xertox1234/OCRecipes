import type { User } from "@shared/schema";
import { storage } from "../storage";
import { invalidateTokenVersionCache } from "../middleware/auth";
import {
  deleteImage,
  type DeleteImageOutcome,
  type ImageKind,
} from "../lib/image-store";
import { fireAndForget } from "../lib/fire-and-forget";
import { logger, toError } from "../lib/logger";
import { revokeAppleIdentities } from "./auth-session";

/**
 * Delete an already re-authenticated account and everything hanging off it,
 * in the one order that is safe (architecture audit 2026-11-06 L1 — this
 * sequence used to be inlined in the DELETE /api/auth/account handler):
 *
 * 1. Revoke Apple tokens while the identity and ticket rows still exist.
 * 2. Read the account's stored images while their rows still exist.
 * 3. Delete the user (FK cascades take the child rows).
 * 4. Invalidate the token cache so in-flight requests are rejected.
 * 5. Fire-and-forget blob cleanup: it never delays or fails the caller.
 *
 * The caller owns re-auth and the second-factor gate; this function assumes
 * both passed. `awaitCleanup` makes step 5 finish before this returns — for
 * `server/scripts/delete-account.ts`, never for a request — and the result
 * then counts the cleanup steps that failed (always 0 when not awaited), so
 * a script run by hand can say that stored pictures were left behind.
 */
export async function deleteAccount(
  user: Pick<User, "id" | "avatarUrl">,
  options: { awaitCleanup?: boolean } = {},
): Promise<{ cleanupFailures: number }> {
  // Revoke Apple tokens BEFORE the delete cascades the identity rows
  // away (App Store 5.1.1(v)); a revoke failure never blocks deletion.
  await revokeAppleIdentities(await storage.listIdentities(user.id));
  // ...and the Apple tokens on link tickets aimed at this account, which
  // the delete would otherwise cascade away unrevoked (audit L17).
  await revokeAppleIdentities(
    (await storage.takeAppleTokensOnTicketsTargeting(user.id)).map(
      (appleRefreshTokenEnc) => ({
        provider: "apple",
        appleRefreshTokenEnc,
      }),
    ),
  );

  // Read the account's stored images while its rows still exist; the
  // delete below cascades them away.
  const ownedImages = await storage.collectUserImageUrls(user.id);

  // Delete user (cascades to all child tables via FK constraints)
  await storage.deleteUser(user.id);

  // Invalidate token cache so any in-flight requests are rejected
  invalidateTokenVersionCache(user.id);

  // Clean up stored images (fire-and-forget; account is already gone, so a
  // storage cleanup failure must not affect the response or add ~50-300ms
  // of R2 latency to it)
  const avatarCleanup = removePicture(user.avatarUrl, "avatar");
  // Filter AFTER the delete: any reference left belongs to another
  // account (a shared copy, or a crafted meal-plan imageUrl), and
  // deleteImage keeps its per-kind prefix guard.
  const imageDeletes = storage
    .filterUnreferencedImageUrls(ownedImages)
    .then((images) =>
      Promise.all(images.map((i) => removePicture(i.url, i.kind))),
    );
  // Catches (and logs) a failed reference check; the deletes log themselves.
  fireAndForget("account-deletion-image-cleanup", imageDeletes);

  // A script exits when this returns, so it waits; a failure is already
  // logged and never fails the deletion, but it is counted: the rows that
  // named these pictures are gone, so nothing can find them later.
  if (!options.awaitCleanup) return { cleanupFailures: 0 };
  const [avatarGone, images] = await Promise.all([
    avatarCleanup,
    imageDeletes.catch(() => null),
  ]);
  return {
    cleanupFailures:
      (avatarGone ? 0 : 1) +
      (images === null
        ? 1 // the reference check itself failed: nothing was tried
        : images.filter((gone) => !gone).length),
  };
}

/** Outcomes of `deleteImage` that leave a picture of ours in storage. */
const LEFT_BEHIND: ReadonlySet<DeleteImageOutcome> = new Set([
  "refused",
  "unknown-base",
  "unlink-failed",
]);

/**
 * Delete one stored picture. Resolves false, never rejects, when the picture
 * is ours and still in storage: the delete threw, or `deleteImage` resolved
 * without deleting. Each such picture is logged with its url and kind: the
 * rows that named it are gone, so this log is the only record that it exists.
 */
async function removePicture(
  url: string | null,
  kind: ImageKind,
): Promise<boolean> {
  const message = "account-deletion: a stored picture was not deleted";
  try {
    const outcome = await deleteImage(url, kind);
    if (!LEFT_BEHIND.has(outcome)) return true;
    logger.error({ url, kind, reason: outcome }, message);
  } catch (err) {
    logger.error({ err: toError(err), url, kind }, message);
  }
  return false;
}
