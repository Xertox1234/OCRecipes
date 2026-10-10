# Manual two-step verification reset

Turns two-step verification off for one account, so its owner can sign in with their password alone and set it up again.

## When

Only when the person has lost **both**:

- the phone with their authenticator app, **and**
- every recovery code.

If they still have the phone or a recovery code, they don't need this. They can sign in with the recovery code, then open **Profile → Sign-in methods → Two-step verification** to move it to a new phone.

A password reset does **not** turn two-step verification off. It only forgets trusted phones. So a forgotten password plus a working phone is not a case for this runbook.

## Verify identity

Turning the factor off on the wrong person's request hands the account to them. Before acting:

1. The request must come **from the email address on the account**. Never act on a request sent from any other address, even if it names the account correctly.
2. Reply to that address and ask for **one detail only the owner knows**. For example, the month the account was created, or a meal they logged recently.
3. Check the answer against the database (the owner runs any production query).

If either check fails, stop and say no. There's no partial reset.

## Run

The owner runs every production command with `!`. Look up the user's id first (by username or email), then:

```bash
# 1. Dry run (the default): prints the username and when two-step was turned on. Writes nothing.
npx tsx scripts/mfa-reset.ts --user <id>

# 2. Real run: turns two-step off, deletes the secret, recovery codes, open
#    challenges and trusted phones, signs every device out, and emails the account.
npx tsx scripts/mfa-reset.ts --user <id> --commit
```

Run it against production with the production `DATABASE_URL` (for example through `railway run`). The script is gated on `--commit`, not on `NODE_ENV`.

Sessions that were already open can keep working for up to **60 seconds** after the reset (the server caches `tokenVersion` for that long).

## After

Tell the person:

- Sign in with your password. No code will be asked.
- Set up two-step verification again (Profile → Sign-in methods), and save the new recovery codes somewhere other than your phone.
- You'll get an email saying two-step verification was turned off. That's expected.
