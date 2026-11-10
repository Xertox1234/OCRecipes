import type { Express, Request, Response } from "express";

import { detectImageMimeType } from "../lib/image-mime";
import { logger, toError } from "../lib/logger";
import {
  PRODUCT_IMAGE_HOST,
  isProductImagePath,
} from "../lib/product-image-proxy";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { createRateLimiter } from "./_rate-limiters";

const FETCH_TIMEOUT_MS = 8_000;
/** OFF's full-size product photos are well under this. */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** OFF image file names carry a revision number, so a URL's bytes never change. */
const CACHE_CONTROL = "public, max-age=2592000, immutable";

// Unauthenticated (an <Image> request carries no bearer token), so it is
// keyed by IP. A product screen loads one photo; a history list loads one per
// row, so the ceiling allows a fast scroll.
const productImageLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  message: "Too many image requests, please try again later",
  keyByUser: false,
});

/** Reads at most `limit` bytes; returns null when the body is larger. */
async function readLimited(
  res: globalThis.Response,
  limit: number,
): Promise<Buffer | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Privacy audit M1: serves an Open Food Facts product photo so the phone never
 * contacts OFF itself. Only `https://images.openfoodfacts.org` plus a validated
 * product-image path is ever fetched; no request header or cookie is forwarded
 * and no redirect is followed.
 */
export function register(app: Express): void {
  // A literal path, not PRODUCT_IMAGE_ROUTE: auth-route-wiring.test.ts only
  // sees quoted paths, and this public route must stay on its allowlist.
  // product-images.test.ts pins the literal to the constant.
  app.get(
    "/api/product-image",
    productImageLimiter,
    async (req: Request, res: Response) => {
      const path = req.query.path;
      if (typeof path !== "string" || !isProductImagePath(path)) {
        sendError(res, 400, "Invalid image path", ErrorCode.VALIDATION_ERROR);
        return;
      }

      let upstream: globalThis.Response;
      try {
        upstream = await fetch(`https://${PRODUCT_IMAGE_HOST}${path}`, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          redirect: "error",
          // OFF's terms ask for an identifying User-Agent (app + contact).
          headers: { "User-Agent": "OCRecipes/1.0 (https://ocrecipes.com)" },
        });
      } catch (err) {
        logger.warn({ err: toError(err) }, "product image fetch failed");
        sendError(res, 502, "Image unavailable", ErrorCode.INTERNAL_ERROR);
        return;
      }

      if (upstream.status === 404) {
        sendError(res, 404, "Image not found", ErrorCode.NOT_FOUND);
        return;
      }
      if (!upstream.ok) {
        sendError(res, 502, "Image unavailable", ErrorCode.INTERNAL_ERROR);
        return;
      }

      let body: Buffer | null;
      try {
        body = await readLimited(upstream, MAX_IMAGE_BYTES);
      } catch (err) {
        logger.warn({ err: toError(err) }, "product image read failed");
        body = null;
      }
      const mime = body ? detectImageMimeType(body) : null;
      if (!body || !mime) {
        sendError(res, 502, "Image unavailable", ErrorCode.INTERNAL_ERROR);
        return;
      }

      res.set({
        "Content-Type": mime,
        "Cache-Control": CACHE_CONTROL,
        "X-Content-Type-Options": "nosniff",
      });
      res.send(body);
    },
  );
}
