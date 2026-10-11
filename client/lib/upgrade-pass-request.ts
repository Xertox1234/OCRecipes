import { apiRequest } from "@/lib/query-client";

/**
 * A request on a short password's restricted pass (password policy spec §6).
 * `authToken: null` pins "no Bearer", so the stored session token is never
 * sent and a 401 is never read as an expired session (no toast). The pass is
 * a plain string from memory — it is never written to any storage.
 */
export function upgradeRequest(
  route: string,
  pass: string,
  data: unknown = {},
): Promise<Response> {
  return apiRequest(
    "POST",
    route,
    data,
    { headers: { Authorization: `UpgradePass ${pass}` } },
    null,
  );
}
