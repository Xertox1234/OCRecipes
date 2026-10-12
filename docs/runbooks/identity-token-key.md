# Never replace IDENTITY_TOKEN_ENC_KEY in place

`IDENTITY_TOKEN_ENC_KEY` (Railway variable) encrypts the Apple refresh tokens stored for Sign in with Apple (`server/lib/social-identity/token-crypto.ts`). **Never regenerate or change it while tokens are stored.**

## Why

Each stored token can only be read with the key that wrote it. A new key passes the startup check (any 32-byte value does), and nothing else complains until we try to use a token. That happens when someone deletes their account or disconnects Apple: the server can't revoke the token, so the account stays connected to the app on Apple's side. Railway keeps no history of a variable, so once the old value is overwritten it's gone.

Keep a copy of the current value in your password manager.

## How you'd find out

Every server start logs one line saying whether the key reads the stored tokens (`identity key check: …`), with `keyFingerprint`: the first 8 hex of a sha256 over the key, which reveals nothing usable about it.

- `passed` (with `checked: N`): fine.
- `no stored Apple tokens to check` (`checked: 0`): fine; nothing to compare against.
- `IDENTITY_TOKEN_ENC_KEY cannot read stored Apple tokens` (error, plus a Sentry event): the key was replaced. The server keeps running (owner ruling 2026-10-12); only Apple revocation is affected.
- `could not run`: the database didn't answer at startup, or the key isn't 32 bytes (startup normally refuses that earlier). On its own this doesn't mean the key was replaced.

A `keyFingerprint` that differs from the previous deploy's means the key changed, and the log timestamp says when.

## If the alert fires

Put the old value back in Railway. That's the only fix: the tokens can't be read without it. If the old value is lost, those tokens can't be revoked; the people they belong to can remove OCRecipes themselves (iPhone Settings → Apple Account → Sign in with Apple).

## Rotating the key on purpose

There's no re-encrypt tool yet. Until one exists, change the key only while **no** tokens are stored: the startup line says `checked: 0`. Once tokens exist, rotating safely needs a script that decrypts every `apple_refresh_token_enc` (in `user_identities` and `pending_social_sign_ins`) with the old key and re-encrypts it with the new one, run before the new key goes live.
