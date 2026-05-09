import type { Express, Response } from "express";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { handleRouteError, parsePositiveIntParam } from "./_helpers";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { crudRateLimit } from "./_rate-limiters";

export function registerCoachCommitmentsRoutes(app: Express): void {
  app.post(
    "/api/chat/commitments/:notebookEntryId/accept",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const notebookEntryId = parsePositiveIntParam(
          req.params.notebookEntryId,
        );
        if (!notebookEntryId) {
          return sendError(
            res,
            400,
            "Invalid notebookEntryId",
            ErrorCode.VALIDATION_ERROR,
          );
        }
        const entry = await storage.getNotebookEntryById(
          notebookEntryId,
          req.userId,
        );
        if (!entry) {
          return sendError(
            res,
            404,
            "Commitment not found",
            ErrorCode.NOT_FOUND,
          );
        }
        if (entry.type !== "commitment") {
          return sendError(
            res,
            400,
            "Entry is not a commitment",
            ErrorCode.VALIDATION_ERROR,
          );
        }
        await storage.updateNotebookEntryStatus(
          notebookEntryId,
          req.userId,
          "completed",
        );
        res.json({ ok: true });
      } catch (error) {
        handleRouteError(res, error, "accept commitment");
      }
    },
  );
}
