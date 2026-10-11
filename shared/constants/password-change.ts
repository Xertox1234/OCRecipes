/** Code emailed for a signed-in password change (change-password spec §4.2). */
export const CHANGE_CODE_TTL_MINUTES = 15;
/** Guesses allowed against one issued code (every guess counts, right or wrong). */
export const CHANGE_CODE_MAX_ATTEMPTS = 5;
/** Codes per account per fixed 24 h window, starting at the first code. */
export const CHANGE_CODE_DAILY_ISSUE_CAP = 5;
