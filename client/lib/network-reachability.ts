/**
 * What "online" means for this app: our API answers. NetInfo's default probe
 * is Google's generate_204, so a network that blocks or slows Google (the iOS
 * CI runner did, run 42810549290) marks the app offline while our server is
 * reachable: the banner covers the header and TanStack pauses every
 * default-networkMode query and mutation.
 *
 * Any JSON reply counts, whatever the status: /api/health answers 503 when the
 * database is down and 429 when rate-limited, and both mean the server is up.
 * Failing a request with a real error beats pausing it. A captive portal or a
 * proxy error page answers HTML or plain text, so it still counts as offline.
 */
export function isApiServerResponse(response: Response): Promise<boolean> {
  const contentType = response.headers.get("content-type") ?? "";
  return Promise.resolve(contentType.includes("application/json"));
}

export function apiReachabilityConfig(apiUrl: string) {
  return {
    reachabilityUrl: `${apiUrl.replace(/\/$/, "")}/api/health`,
    reachabilityTest: isApiServerResponse,
  };
}
