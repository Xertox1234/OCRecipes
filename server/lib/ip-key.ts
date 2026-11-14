import type { Request } from "express";
import { ipKeyGenerator as normalizeIpKey } from "express-rate-limit";

/**
 * Extract the client IP for rate limiting (auth routes and fallback when no
 * userId). On Railway (detected via the injected RAILWAY_ENVIRONMENT_NAME),
 * prefers the edge proxy's X-Real-IP — Railway overwrites it on every
 * request, so it is not client-spoofable there, and it is immune to
 * proxy-hop-count drift that would break the req.ip/X-Forwarded-For path.
 * Anywhere else the header is client-suppliable (choose-your-own-bucket
 * evasion), so trust fails closed to req.ip (trust proxy = 1) → socket
 * address. If Cloudflare proxying is ever enabled in front of the API,
 * switch to CF-Connecting-IP and re-evaluate the hop count.
 */
export function ipKeyGenerator(req: Request): string {
  if (process.env.RAILWAY_ENVIRONMENT_NAME) {
    const realIp = req.headers["x-real-ip"];
    if (typeof realIp === "string" && realIp) return normalizeIpKey(realIp);
  }
  const ip = req.ip || req.socket.remoteAddress;
  // normalizeIpKey buckets IPv6 to its /56 subnet (IPv4 passes through) so
  // a user can't dodge the limiter by cycling addresses within their block.
  return ip ? normalizeIpKey(ip) : "unknown";
}
