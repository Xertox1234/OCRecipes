import crypto from "node:crypto";

const AUTH_TAG_BYTES = 16;

// Independent of JWT_SECRET on purpose: rotating JWT_SECRET must not make
// stored Apple refresh tokens unreadable (we could no longer revoke them).
export function loadIdentityKey(
  raw: string | undefined = process.env.IDENTITY_TOKEN_ENC_KEY,
): Buffer {
  if (!raw) throw new Error("IDENTITY_TOKEN_ENC_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("IDENTITY_TOKEN_ENC_KEY must decode to 32 bytes");
  }
  return key;
}

/** AES-256-GCM. Format: `v1:<iv b64>:<tag b64>:<ciphertext b64>`. */
export function encryptToken(
  plain: string,
  key: Buffer = loadIdentityKey(),
): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(":");
}

export function decryptToken(
  blob: string,
  key: Buffer = loadIdentityKey(),
): string {
  const [version, iv, tag, ct] = blob.split(":");
  if (version !== "v1" || !iv || !tag || !ct) {
    throw new Error("Unrecognised token blob");
  }
  // Pin the tag length: GCM otherwise accepts a truncated tag, which weakens
  // the integrity check to however many bytes an attacker leaves.
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "base64"),
    { authTagLength: AUTH_TAG_BYTES },
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ct, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
