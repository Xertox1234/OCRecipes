import type { Express, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import {
  formatZodError,
  handleRouteError,
  parsePositiveIntParam,
  parseQueryInt,
  parseTimezone,
} from "./_helpers";
import { crudRateLimit } from "./_rate-limiters";
import { sendError } from "../lib/api-errors";
import { civilDateToInstant } from "../lib/civil-date";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  notebookEntryTypes,
  notebookEntryStatusValues,
} from "@shared/schemas/coach-notebook";
import { toSecondPerson } from "@shared/lib/notebook-text";

/** Ids the save popup / "What Coach knows" page acts on (visible memory). */
const idsSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(20),
});

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
  // ── Visible memory (spec 2026-11-08) — registered before the /:id routes ──

  // GET /api/coach/notebook/unseen — new saves the popup hasn't shown yet.
  app.get(
    "/api/coach/notebook/unseen",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const rows = await storage.getUnseenNotebookSaves(req.userId);
        res.json({
          entries: rows.map((e) => ({
            id: e.id,
            type: e.type,
            content: toSecondPerson(e.content),
            label: e.label,
          })),
        });
      } catch (error) {
        handleRouteError(res, error, "list unseen notebook saves");
      }
    },
  );

  // POST /api/coach/notebook/shown — the popup displayed these.
  app.post(
    "/api/coach/notebook/shown",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = idsSchema.safeParse(req.body);
        if (!parsed.success)
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
        await storage.markNotebookEntriesShown(req.userId, parsed.data.ids);
        res.status(204).end();
      } catch (error) {
        handleRouteError(res, error, "mark notebook saves shown");
      }
    },
  );

  // POST /api/coach/notebook/confirm — popup closed without Undo, or "Yes".
  app.post(
    "/api/coach/notebook/confirm",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = idsSchema.safeParse(req.body);
        if (!parsed.success)
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
        const confirmed = await storage.confirmNotebookEntries(
          req.userId,
          parsed.data.ids,
        );
        res.json({ confirmed });
      } catch (error) {
        handleRouteError(res, error, "confirm notebook entries");
      }
    },
  );

  // POST /api/coach/notebook/reject — Undo / Remove (never re-saved).
  app.post(
    "/api/coach/notebook/reject",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const parsed = idsSchema.safeParse(req.body);
        if (!parsed.success)
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
        const rejected = await storage.rejectNotebookEntries(
          req.userId,
          parsed.data.ids,
        );
        res.json({ rejected });
      } catch (error) {
        handleRouteError(res, error, "reject notebook entries");
      }
    },
  );

  // DELETE /api/coach/notebook — "Clear everything Coach knows".
  app.delete(
    "/api/coach/notebook",
    requireAuth,
    crudRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        await storage.clearNotebook(req.userId);
        res.status(204).end();
      } catch (error) {
        handleRouteError(res, error, "clear notebook");
      }
    },
  );

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
          // Added by the user themselves: confirmed and already "shown";
          // a commitment's label is their own words (visible memory).
          confirmedAt: new Date(),
          shownAt: new Date(),
          label: type === "commitment" ? content.slice(0, 120) : null,
          // Local midnight in the user's zone, not `new Date(followUpDate)`
          // (UTC midnight): the reminder reads `lte(followUpDate, now)`, and
          // the chat-extraction writer (coach-pro-chat.ts) anchors the same
          // column this way. Both writers must share one basis.
          followUpDate: followUpDate
            ? civilDateToInstant(
                followUpDate,
                parseTimezone(req.headers["x-timezone"]),
              )
            : null,
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
            // Same basis as the POST handler above.
            followUpDate: followUpDate
              ? civilDateToInstant(
                  followUpDate,
                  parseTimezone(req.headers["x-timezone"]),
                )
              : null,
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
