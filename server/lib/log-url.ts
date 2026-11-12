/**
 * The path of a request URL, without its query string or fragment.
 *
 * The request log keeps this instead of the full URL: query strings carry what
 * the user typed (food names, chat search text), which the log has no use for
 * (privacy audit 2026-11-10, M12).
 */
export function urlPathOnly(url: string | undefined): string {
  if (!url) return "";
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
}

// Express matches paths without regard to letter case and allows one trailing
// slash, so these do too.
const NUTRITION_BARCODE_PATH = /^\/api\/nutrition\/barcode\/[^/]+\/?$/i;
const VERIFICATION_ITEM_PATH = /^\/api\/verification\/([^/]+)\/?$/i;
/** The fixed routes beside `/api/verification/:barcode` (submit, user-count…). */
const ROUTE_NAME = /^[a-z-]+$/;

/**
 * The path as the request log keeps it: `urlPathOnly`, with a scanned barcode
 * replaced by its route parameter name. Two routes carry the barcode in the
 * path itself, and what a person scans is no more the log's business than
 * what they type (security audit 2026-11-12, L12).
 *
 * On the verification path anything that is not a plain route name is
 * replaced, so a new fixed route there stays readable without a list to keep.
 */
export function loggedPath(url: string | undefined): string {
  const path = urlPathOnly(url);
  if (NUTRITION_BARCODE_PATH.test(path)) return "/api/nutrition/barcode/:code";
  const item = VERIFICATION_ITEM_PATH.exec(path);
  if (item && !ROUTE_NAME.test(item[1])) return "/api/verification/:barcode";
  return path;
}

/** The request as pino-http hands it to a serializer: `id` is genReqId's. */
interface LoggedRequest {
  id?: unknown;
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * What the request log keeps of a request. The id is the one `genReqId`
 * produced (a UUID it checked or made), not the `x-request-id` header: the
 * header is whatever the client sent, at any length.
 */
export function requestLogFields(req: LoggedRequest) {
  return {
    id: req.id,
    method: req.method,
    url: loggedPath(req.url),
    headers: {
      "content-type": req.headers["content-type"],
      "user-agent": req.headers["user-agent"],
    },
  };
}
