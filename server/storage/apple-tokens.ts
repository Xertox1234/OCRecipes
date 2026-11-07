import { pendingSocialSignIns, userIdentities } from "@shared/schema";
import { db } from "../db";
import { sql } from "drizzle-orm";

// Apple-grant queries moved out of identities.ts (pure move); re-exported
// from there so the storage facade and existing importers need no change.

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
 * Stored Apple refresh tokens for the boot-time key check: up to `limit` from
 * linked identities, OLDEST first (a half-rotated table fails there first),
 * plus up to `limit` from sign-in tickets.
 */
export async function sampleStoredAppleTokens(
  limit: number,
): Promise<string[]> {
  const result = await db.execute<{ token: string }>(sql`
    (select ${userIdentities.appleRefreshTokenEnc} as token
      from ${userIdentities}
      where ${userIdentities.appleRefreshTokenEnc} is not null
      order by ${userIdentities.createdAt} asc
      limit ${limit})
    union all
    (select ${pendingSocialSignIns.appleRefreshTokenEnc} as token
      from ${pendingSocialSignIns}
      where ${pendingSocialSignIns.appleRefreshTokenEnc} is not null
      order by ${pendingSocialSignIns.expiresAt} asc
      limit ${limit})`);
  return result.rows.map((r) => r.token);
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
