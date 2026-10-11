# Someone can't get a password reset code

What to do when a person says Forgot password never sends them a code, or every code they get is already dead.

## Why it can happen

Email reset has two limits stored in the database, so a deploy doesn't reset them:

- **6 codes per account per 24-hour window.** The window is fixed: it starts at the first code and restarts 24 hours later. The 7th request in a window stores nothing and sends nothing. The app still shows "we've sent a code", because a different answer would reveal which emails have accounts.
- **5 wrong guesses per code.** After that the code is dead, and the person has to ask for a new one.

Anyone who knows the address can use up both limits. About 6 requests a day stays under the per-email limit of 3 an hour, and rotating IPs gets past the per-IP limit. The window restarts, but they can use it up again each time it does, so someone who keeps doing this can keep the account locked out of email reset **for as long as they keep going**, not just for 24 hours. This is an accepted risk (auth audit 2026-10-10 L5). The limits are what make guessing a 6-digit code impractical: 30 guesses per window against a million codes (up to about 55 in a 24-hour span that crosses a window edge, which can fit 11 codes).

The lockout is visible. The person receives every code email, including the ones they didn't ask for.

## Telling the cases apart

- **Lots of code emails they didn't ask for:** someone is using up the limits. Go to "Help".
- **No email at all:** check spam first. Then check that they're using the address on the account. Codes go only to the account's current address, never to an email change that is still waiting to be confirmed.
- **A code arrives but is rejected:** codes last 15 minutes, and only the newest one works.

## Help

1. Verify identity the same way as `docs/runbooks/mfa-manual-reset.md` → "Verify identity". The request has to come from the address on the account.
2. If they are still signed in on any phone, they can use **Change password** there (above).
3. If the account also has a Google or Apple sign-in connected, they can sign in that way. They don't need a reset to get in.
4. Otherwise there is no self-serve way out while the attacker keeps going. Tell them it is safe: the attacker gets codes sent to the person's own inbox, never to themselves.

## Change password (signed in)

Someone still signed in on their phone can set a new password without a reset code: **Profile → Sign-in methods → Change password**, then their current password, **"I forgot it"** → Google/Apple, or **"Email me a code"**. That code is separate from the Forgot password code and only a signed-in person can request it, so the attacker using up the reset codes can't block it. Two-step accounts also enter their authenticator code (not with Google/Apple).
