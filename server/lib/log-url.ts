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
