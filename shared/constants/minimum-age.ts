/**
 * The youngest age the app accepts (privacy audit G5, owner ruling
 * 2026-11-10). 14 rather than COPPA's 13: under Quebec's Law 25 consent for a
 * person under 14 has to come from a parent or tutor, and the app has no
 * parental-consent flow.
 *
 * The site pages state the same age by hand: `site/terms/index.html` and
 * `site/privacy/index.html`.
 */
export const MINIMUM_AGE = 14;

/** The sign-up checkbox. The server refuses a registration without it. */
export const AGE_ATTESTATION_LABEL = `I confirm I am ${MINIMUM_AGE} years of age or older`;

export const AGE_ATTESTATION_ERROR = `You must confirm you are ${MINIMUM_AGE} years of age or older`;
