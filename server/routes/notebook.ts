import type { Express, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import {
  formatZodError,
  handleRouteError,
  parsePositiveIntParam,
  parseQueryInt,
} from "./_helpers";
import { crudRateLimit } from "./_rate-limiters";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  notebookEntryTypes,
  notebookEntryStatusValues,
} from "@shared/schemas/coach-notebook";

const createEntrySchema = z.object({
  type: z.enum(notebookEntryTypes),
  content: z.string().min(1).max(500),
  followUpDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
});

const updateEntrySchema = z.object({
  content: z.string().min(1).max(500).optional(),
  type: z.enum(notebookEntryTypes).optional(),
  followUpDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  status: z.enum(notebookEntryStatusValues).optional(),
});

export function register(app: Express): void {
  // GET /api/coach/notebook
  app.get(
    "/api/coach/notebook",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const limit = parseQueryInt(req.query.limit, { default: 50, max: 100 });
        const page = parseQueryInt(req.query.page, {
          default: 1,
          min: 1,
          max: 100,
        });
        const type =
          typeof req.query.type === "string" ? req.query.type : undefined;
        const status =
          typeof req.query.status === "string" ? req.query.status : undefined;
        if (type && !(notebookEntryTypes as readonly string[]).includes(type))
          return sendError(
            res,
            400,
            "Invalid type",
            ErrorCode.VALIDATION_ERROR,
          );
        if (
          status &&
          !(notebookEntryStatusValues as readonly string[]).includes(status)
        )
          return sendError(
            res,
            400,
            "Invalid status",
            ErrorCode.VALIDATION_ERROR,
          );
        const entries = await storage.getNotebookEntries(req.userId, {
          type,
          status,
          page,
          limit,
        });
        res.json(entries);
      } catch (error) {
        handleRouteError(res, error, "list notebook entries");
      }
    },
  );

  // POST /api/coach/notebook
  app.post(
    "/api/coach/notebook",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = createEntrySchema.safeParse(req.body);
        if (!parsed.success)
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
        const { type, content, followUpDate } = parsed.data;
        const entry = await storage.createNotebookEntry({
          userId: req.userId,
          type,
          content,
          status: "active",
          followUpDate: followUpDate ? new Date(followUpDate) : null,
          sourceConversationId: null,
          dedupeKey: null,
        });
        res.status(201).json(entry);
      } catch (error) {
        handleRouteError(res, error, "create notebook entry");
      }
    },
  );

  // PATCH /api/coach/notebook/:id
  app.patch(
    "/api/coach/notebook/:id",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id)
          return sendError(
            res,
            400,
            "Invalid entry ID",
            ErrorCode.VALIDATION_ERROR,
          );
        const parsed = updateEntrySchema.safeParse(req.body);
        if (!parsed.success)
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
        const { content, type, followUpDate, status } = parsed.data;
        const updated = await storage.updateNotebookEntry(id, req.userId, {
          ...(content !== undefined && { content }),
          ...(type !== undefined && { type }),
          ...(followUpDate !== undefined && {
            followUpDate: followUpDate ? new Date(followUpDate) : null,
          }),
          ...(status !== undefined && { status }),
        });
        if (!updated)
          return sendError(res, 404, "Entry not found", ErrorCode.NOT_FOUND);
        res.json(updated);
      } catch (error) {
        handleRouteError(res, error, "update notebook entry");
      }
    },
  );

  // DELETE /api/coach/notebook/:id
  app.delete(
    "/api/coach/notebook/:id",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = parsePositiveIntParam(req.params.id);
        if (!id)
          return sendError(
            res,
            400,
            "Invalid entry ID",
            ErrorCode.VALIDATION_ERROR,
          );
        const deleted = await storage.deleteNotebookEntry(id, req.userId);
        if (!deleted)
          return sendError(res, 404, "Entry not found", ErrorCode.NOT_FOUND);
        res.status(204).send();
      } catch (error) {
        handleRouteError(res, error, "delete notebook entry");
      }
    },
  );
}
