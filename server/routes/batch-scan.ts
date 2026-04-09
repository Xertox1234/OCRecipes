import type { Express, Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { storage, BatchStorageError } from "../storage";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { batchSaveRequestSchema } from "@shared/types/batch-scan";
import { isValidBarcode } from "@shared/constants/classification";
import { formatZodError, handleRouteError } from "./_helpers";
import { createRateLimiter } from "./_rate-limiters";

const batchSaveRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: "Too many batch save requests. Please wait.",
});

export function register(app: Express): void {
  // POST /api/batch/save — Save batch scanned items to a destination
  app.post(
    "/api/batch/save",
    requireAuth,
    batchSaveRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = batchSaveRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
        }

        const { items, destination, groceryListId, mealType } = parsed.data;

        // Validate barcodes server-side
        for (const item of items) {
          if (item.barcode && !isValidBarcode(item.barcode)) {
            return sendError(
              res,
              400,
              "One or more items contain an invalid barcode format",
              ErrorCode.VALIDATION_ERROR,
            );
          }
        }

        const userId = req.userId;

        switch (destination) {
          case "daily_log": {
            const result = await storage.batchCreateScannedItemsWithLogs(
              items,
              userId,
              mealType,
            );
            return res.json({
              success: true,
              destination,
              created: result.scannedCount,
            });
          }
          case "pantry": {
            const result = await storage.batchCreatePantryItems(items, userId);
            return res.json({
              success: true,
              destination,
              created: result.count,
            });
          }
          case "grocery_list": {
            try {
              const result = await storage.batchCreateGroceryItems(
                items,
                userId,
                groceryListId,
              );
              return res.json({
                success: true,
                destination,
                created: result.count,
                groceryListId: result.groceryListId,
              });
            } catch (error) {
              if (error instanceof BatchStorageError) {
                if (error.code === "NOT_FOUND") {
                  return sendError(
                    res,
                    404,
                    "Grocery list not found",
                    ErrorCode.NOT_FOUND,
                  );
                }
                if (error.code === "LIMIT_REACHED") {
                  return sendError(
                    res,
                    400,
                    error.message,
                    ErrorCode.VALIDATION_ERROR,
                  );
                }
              }
              throw error;
            }
          }
        }
      } catch (error) {
        handleRouteError(res, error, "save batch items");
      }
    },
  );
}
