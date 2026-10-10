import crypto from "node:crypto";
import {
  TOTP_CODE_LENGTH,
  TOTP_PERIOD_SECONDS,
  TOTP_WINDOW_STEPS,
} from "@shared/constants/mfa";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32, no padding (what authenticator apps expect). */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    // Only the low `bits` (≤ 12) bits are ever read; mask to stay in int range.
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error("Invalid base32");
    value = ((value << 5) | idx) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", secret).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin =
    ((h[off] & 0x7f) << 24) |
    (h[off + 1] << 16) |
    (h[off + 2] << 8) |
    h[off + 3];
  return (bin % 10 ** TOTP_CODE_LENGTH)
    .toString()
    .padStart(TOTP_CODE_LENGTH, "0");
}

export function timeStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

/** The matched time step, or null. Constant-time per comparison. */
export function matchTotp(
  secret: Buffer,
  code: string,
  nowMs: number,
): number | null {
  if (!new RegExp(`^\\d{${TOTP_CODE_LENGTH}}$`).test(code)) return null;
  const given = Buffer.from(code);
  const current = timeStep(nowMs);
  for (let d = -TOTP_WINDOW_STEPS; d <= TOTP_WINDOW_STEPS; d++) {
    const expected = Buffer.from(hotp(secret, current + d));
    if (crypto.timingSafeEqual(expected, given)) return current + d;
  }
  return null;
}

export function otpauthUrl(secretB32: string, accountName: string): string {
  const label = `OCRecipes:${encodeURIComponent(accountName)}`;
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=OCRecipes&algorithm=SHA1&digits=${TOTP_CODE_LENGTH}&period=${TOTP_PERIOD_SECONDS}`;
}
