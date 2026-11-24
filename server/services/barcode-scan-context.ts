import { storage } from "../storage";
import { logger, toError } from "../lib/logger";
import { parseUserAllergies } from "@shared/constants/allergens";
import { lookupBarcode } from "./barcode-lookup";
import type { ProfileOutcome } from "./scan-flags";

/**
 * Everything a barcode scan response is built from, loaded in parallel: the
 * product lookup, its community verification, and the scanning user's
 * allergies. Shared by the GET (plain scan) and POST (label override) barcode
 * routes so the fail-dangerous profile read exists once.
 *
 * Rejects only when the lookup or verification read rejects; the route maps
 * that (e.g. UpstreamUnavailableError → 503). A null `result` is "not found".
 */
export async function loadBarcodeScanContext(code: string, userId: string) {
  const [result, verification, profileOutcome] = await Promise.all([
    lookupBarcode(code),
    storage.getVerification(code),
    loadAllergyProfile(userId),
  ]);
  return { result, verification, profileOutcome };
}

/**
 * The scanning user's allergies. Fail-dangerous, NOT fatal: a profile-read
 * hiccup must never break scanning. On rejection we degrade to a "couldn't
 * check" outcome — never silence, never a 500 (Global Constraint: allergen
 * flags fail-dangerous).
 */
export function loadAllergyProfile(userId: string): Promise<ProfileOutcome> {
  return storage.getUserProfile(userId).then(
    (profile): ProfileOutcome => ({
      ok: true,
      allergies: parseUserAllergies(profile?.allergies),
    }),
    (err): ProfileOutcome => {
      logger.warn({ err: toError(err) }, "scan-flags: profile read failed");
      return { ok: false };
    },
  );
}
