import {
  authNonces,
  pendingSocialSignIns,
  userIdentities,
  users,
  type InsertUserIdentity,
  type PendingSocialSignIn,
  type User,
  type UserIdentity,
  socialLinkGuesses,
} from "@shared/schema";
import { db } from "../db";
import { and, count, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { randomToken, sha256Hex } from "../lib/social-identity/nonce";
import { isReservedUsername, ReservedUsernameError } from "./users";

export type NoncePurpose = "sign_in" | "link" | "reauth";
export type ProviderName = "google" | "apple";

export interface SignInMethods {
  password: boolean;
  google: { email: string | null } | null;
  apple: { email: string | null; isPrivateRelay: boolean } | null;
}

export interface PendingSignInInput {
  kind: "sign_up" | "link";
  provider: ProviderName;
  providerSubject: string;
  email: string;
  isPrivateRelay: boolean;
  providerAuthoritative: boolean;
  /** Provider email_verified claim — becomes users.emailVerified on sign-up. */
  emailVerified: boolean;
  displayName: string | null;
  appleRefreshTokenEnc: string | null;
  targetUserId: string | null;
}

const NONCE_TTL = sql`now() + interval '10 minutes'`;
const TICKET_TTL = sql`now() + interval '15 minutes'`;
const MAX_LINK_ATTEMPTS = 5;
// Bounded: the sweep runs on a public sign-in request.
const SWEEP_BATCH = 50;

export async function issueNonce(
  purpose: NoncePurpose,
  userId: string | null,
): Promise<{ nonce: string; nonceHash: string }> {
  await db.delete(authNonces).where(lt(authNonces.expiresAt, sql`now()`));
  const nonce = randomToken();
  const nonceHash = sha256Hex(nonce);
  await db
    .insert(authNonces)
    .values({ nonceHash, purpose, userId, expiresAt: NONCE_TTL });
  return { nonce, nonceHash };
}

/**
 * Atomic check-and-burn. The nonce's binding must match the caller EXACTLY:
 * a public nonce (user_id NULL) only from an unauthenticated caller
 * (`userId` null), a bound nonce only from that user. So a nonce minted by
 * the public Connect prompt can never be replayed on a signed-in route
 * (POST /api/auth/identities), and vice versa. A `reauth` nonce is always
 * bound, so it is never consumable with `userId` null.
 */
export async function consumeNonce(
  nonce: string,
  purpose: NoncePurpose,
  userId: string | null,
): Promise<boolean> {
  const owner =
    userId === null
      ? purpose === "reauth"
        ? sql`false`
        : isNull(authNonces.userId)
      : eq(authNonces.userId, userId);
  const rows = await db
    .delete(authNonces)
    .where(
      and(
        eq(authNonces.nonceHash, sha256Hex(nonce)),
        eq(authNonces.purpose, purpose),
        gt(authNonces.expiresAt, sql`now()`),
        owner,
      ),
    )
    .returning();
  return rows.length === 1;
}

/**
 * Delete up to SWEEP_BATCH expired tickets. Returns the encrypted Apple
 * refresh tokens they carried that are safe to revoke: revoking can end the
 * person's whole Apple authorization for the app, so a token is kept off the
 * list when its Apple ID is linked to an account or has a newer live ticket.
 * (The CTE's outer query sees the pre-delete snapshot; the swept rows are
 * expired, so `expires_at > now()` excludes them.)
 */
export async function sweepExpiredPendingSignIns(): Promise<string[]> {
  const t = pendingSocialSignIns;
  const result = await db.execute<{ token: string }>(sql`
    with swept as (
      delete from ${t}
      where ${t.ticketHash} in (
        select ${t.ticketHash} from ${t}
        where ${t.expiresAt} < now()
        limit ${SWEEP_BATCH}
      )
      returning ${t.provider} as provider,
        ${t.providerSubject} as subject,
        ${t.appleRefreshTokenEnc} as token
    )
    select s.token from swept s
    where s.provider = 'apple' and s.token is not null
      and not exists (
        select 1 from ${userIdentities} i
        where i.provider = s.provider and i.provider_subject = s.subject
      )
      and not exists (
        select 1 from ${t} p
        where p.provider = s.provider and p.provider_subject = s.subject
          and p.expires_at > now()
      )`);
  return result.rows.map((r) => r.token);
}

/**
 * Whether an Apple ID's grant is still in use — a linked identity or a live
 * ticket holds it. Revoking any token ends the app's whole Apple grant, so a
 * token is only revoked when this is false (the expiry sweep's rule).
 */
export async function appleGrantInUse(sub: string): Promise<boolean> {
  const result = await db.execute<{ inUse: boolean }>(sql`
    select exists (
      select 1 from ${userIdentities} i
      where i.provider = 'apple' and i.provider_subject = ${sub}
    ) or exists (
      select 1 from ${pendingSocialSignIns} p
      where p.provider = 'apple' and p.provider_subject = ${sub}
        and p.expires_at > now()
    ) as "inUse"`);
  return Boolean(result.rows[0]?.inUse);
}

/**
 * Delete the link tickets aimed at an account (they would cascade away with
 * it) and return their Apple tokens that nobody else holds — same filters as
 * the expiry sweep — so account deletion can revoke them (audit L17).
 */
export async function takeAppleTokensOnTicketsTargeting(
  userId: string,
): Promise<string[]> {
  const t = pendingSocialSignIns;
  const result = await db.execute<{ token: string }>(sql`
    with taken as (
      delete from ${t}
      where ${t.targetUserId} = ${userId}
      returning ${t.provider} as provider,
        ${t.providerSubject} as subject,
        ${t.appleRefreshTokenEnc} as token
    )
    select s.token from taken s
    where s.provider = 'apple' and s.token is not null
      and not exists (
        select 1 from ${userIdentities} i
        where i.provider = s.provider and i.provider_subject = s.subject
      )
      and not exists (
        select 1 from ${t} p
        where p.provider = s.provider and p.provider_subject = s.subject
          and p.expires_at > now()
          and p.target_user_id is distinct from ${userId}
      )`);
  return result.rows.map((r) => r.token);
}

export async function createPendingSignIn(
  input: PendingSignInInput,
): Promise<string> {
  const ticket = randomToken();
  await db.insert(pendingSocialSignIns).values({
    ...input,
    ticketHash: sha256Hex(ticket),
    expiresAt: TICKET_TTL,
  });
  return ticket;
}

export async function getPendingSignIn(
  ticket: string,
  kind: "sign_up" | "link",
): Promise<PendingSocialSignIn | undefined> {
  const [row] = await db
    .select()
    .from(pendingSocialSignIns)
    .where(
      and(
        eq(pendingSocialSignIns.ticketHash, sha256Hex(ticket)),
        eq(pendingSocialSignIns.kind, kind),
        gt(pendingSocialSignIns.expiresAt, sql`now()`),
      ),
    );
  return row;
}

export async function reservePendingLinkAttempt(
  ticket: string,
): Promise<PendingSocialSignIn | undefined> {
  const [row] = await db
    .update(pendingSocialSignIns)
    .set({ attempts: sql`${pendingSocialSignIns.attempts} + 1` })
    .where(
      and(
        eq(pendingSocialSignIns.ticketHash, sha256Hex(ticket)),
        eq(pendingSocialSignIns.kind, "link"),
        gt(pendingSocialSignIns.expiresAt, sql`now()`),
        lt(pendingSocialSignIns.attempts, MAX_LINK_ATTEMPTS),
      ),
    )
    .returning();
  return row;
}

/** The per-account guess window (spec §4.4) — fixed, from the first guess. */
const LINK_GUESS_WINDOW_MINUTES = 15;

/**
 * Reserve one password guess against `userId` through /api/auth/social/link
 * (auth audit 2026-10-10 L15). One atomic upsert: a fixed 15-minute window
 * from the first guess, restarted once it has passed; refused (false) when
 * `max` guesses are already counted in it. In Postgres, so a deploy never
 * resets the cap, and concurrent guesses serialize on the row.
 */
export async function reserveLinkPasswordGuess(
  userId: string,
  max: number,
): Promise<boolean> {
  const expired = sql`${socialLinkGuesses.windowStart} <= now() - (${LINK_GUESS_WINDOW_MINUTES} * interval '1 minute')`;
  const [row] = await db
    .insert(socialLinkGuesses)
    .values({ userId, count: 1, windowStart: sql`now()` })
    .onConflictDoUpdate({
      target: socialLinkGuesses.userId,
      set: {
        count: sql`CASE WHEN ${expired} THEN 1 ELSE ${socialLinkGuesses.count} + 1 END`,
        windowStart: sql`CASE WHEN ${expired} THEN now() ELSE ${socialLinkGuesses.windowStart} END`,
      },
      setWhere: sql`${expired} OR ${socialLinkGuesses.count} < ${max}`,
    })
    .returning({ userId: socialLinkGuesses.userId });
  return Boolean(row);
}

/** Give a guess back — the password was right, and only failures count. */
export async function refundLinkPasswordGuess(userId: string): Promise<void> {
  await db
    .update(socialLinkGuesses)
    .set({ count: sql`GREATEST(${socialLinkGuesses.count} - 1, 0)` })
    .where(eq(socialLinkGuesses.userId, userId));
}

export async function completeLinkFromTicket(
  ticket: string,
  opts: { markEmailVerified: boolean },
): Promise<UserIdentity | undefined> {
  return completeLinkByTicketHash(sha256Hex(ticket), opts);
}

/**
 * completeLinkFromTicket by the ticket's hash — an MFA link challenge stores
 * only the hash and completes the link after the code passes. Keeps the
 * kind = 'link' and unexpired guards, so a dead ticket fails closed.
 */
export async function completeLinkByTicketHash(
  ticketHash: string,
  opts: { markEmailVerified: boolean },
): Promise<UserIdentity | undefined> {
  return db.transaction(async (tx) => {
    const [t] = await tx
      .delete(pendingSocialSignIns)
      .where(
        and(
          eq(pendingSocialSignIns.ticketHash, ticketHash),
          eq(pendingSocialSignIns.kind, "link"),
          gt(pendingSocialSignIns.expiresAt, sql`now()`),
        ),
      )
      .returning();
    if (!t || !t.targetUserId) return undefined;
    const [identity] = await tx
      .insert(userIdentities)
      .values({
        userId: t.targetUserId,
        provider: t.provider,
        providerSubject: t.providerSubject,
        email: t.email,
        isPrivateRelay: t.isPrivateRelay,
        appleRefreshTokenEnc: t.appleRefreshTokenEnc,
        lastUsedAt: sql`now()`,
      })
      .returning();
    if (opts.markEmailVerified) {
      await tx
        .update(users)
        .set({ emailVerified: true })
        .where(eq(users.id, t.targetUserId));
    }
    return identity;
  });
}

/**
 * Burn a sign_up ticket and create the account + identity in ONE transaction.
 * A unique violation (username/email race) or ReservedUsernameError throws and
 * rolls back, so the ticket survives and the person can pick another name.
 */
export async function createUserWithIdentity(
  ticket: string,
  username: string,
): Promise<User | undefined> {
  if (isReservedUsername(username)) throw new ReservedUsernameError(username);
  return db.transaction(async (tx) => {
    const [t] = await tx
      .delete(pendingSocialSignIns)
      .where(
        and(
          eq(pendingSocialSignIns.ticketHash, sha256Hex(ticket)),
          eq(pendingSocialSignIns.kind, "sign_up"),
          gt(pendingSocialSignIns.expiresAt, sql`now()`),
        ),
      )
      .returning();
    if (!t) return undefined;
    const [user] = await tx
      .insert(users)
      .values({
        username,
        email: t.email,
        password: null,
        emailVerified: t.emailVerified,
        displayName: t.displayName,
      })
      .returning();
    await tx.insert(userIdentities).values({
      userId: user.id,
      provider: t.provider,
      providerSubject: t.providerSubject,
      email: t.email,
      isPrivateRelay: t.isPrivateRelay,
      appleRefreshTokenEnc: t.appleRefreshTokenEnc,
      lastUsedAt: sql`now()`,
    });
    return user;
  });
}

export async function findIdentity(
  provider: ProviderName,
  sub: string,
): Promise<UserIdentity | undefined> {
  const [row] = await db
    .select()
    .from(userIdentities)
    .where(
      and(
        eq(userIdentities.provider, provider),
        eq(userIdentities.providerSubject, sub),
      ),
    );
  return row;
}

export async function listIdentities(userId: string): Promise<UserIdentity[]> {
  return db
    .select()
    .from(userIdentities)
    .where(eq(userIdentities.userId, userId));
}

export async function insertIdentity(
  input: InsertUserIdentity,
): Promise<UserIdentity> {
  const [row] = await db
    .insert(userIdentities)
    .values({ ...input, lastUsedAt: sql`now()` })
    .returning();
  return row;
}

/**
 * Remove one provider — refused (undefined) when it is the account's last way
 * to sign in (no password, no other provider). The check runs under a lock on
 * the user row so two concurrent disconnects can't each see the other's row
 * still present and leave the account with none (auth audit 2026-10-10 L16).
 */
export async function deleteIdentity(
  userId: string,
  provider: ProviderName,
): Promise<UserIdentity | undefined> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select({ password: users.password })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (!user) return undefined;
    if (user.password === null) {
      const [{ n }] = await tx
        .select({ n: count() })
        .from(userIdentities)
        .where(eq(userIdentities.userId, userId));
      if (n <= 1) return undefined;
    }
    const [row] = await tx
      .delete(userIdentities)
      .where(
        and(
          eq(userIdentities.userId, userId),
          eq(userIdentities.provider, provider),
        ),
      )
      .returning();
    return row;
  });
}

export async function setAppleRefreshToken(
  identityId: string,
  userId: string,
  enc: string,
): Promise<void> {
  await db
    .update(userIdentities)
    .set({ appleRefreshTokenEnc: enc })
    .where(
      and(eq(userIdentities.id, identityId), eq(userIdentities.userId, userId)),
    );
}

export async function touchIdentity(
  identityId: string,
  userId: string,
): Promise<void> {
  await db
    .update(userIdentities)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(eq(userIdentities.id, identityId), eq(userIdentities.userId, userId)),
    );
}

export async function getSignInMethods(userId: string): Promise<SignInMethods> {
  const [u] = await db
    .select({ hasPassword: sql<boolean>`${users.password} is not null` })
    .from(users)
    .where(eq(users.id, userId));
  const identities = await listIdentities(userId);
  const google = identities.find((i) => i.provider === "google");
  const apple = identities.find((i) => i.provider === "apple");
  return {
    password: Boolean(u?.hasPassword),
    google: google ? { email: google.email } : null,
    apple: apple
      ? { email: apple.email, isPrivateRelay: apple.isPrivateRelay }
      : null,
  };
}
