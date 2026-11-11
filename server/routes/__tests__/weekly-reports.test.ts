import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { register } from "../weekly-reports";
import {
  createMockWeeklyFacts,
  createMockWeeklyReport,
  createMockWeeklyReportContent,
} from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: {
    listWeeklyReports: vi.fn(),
    getWeeklyReport: vi.fn(),
    getPendingPopup: vi.fn(),
    markWeeklyReportSeen: vi.fn(),
    markCelebrationShown: vi.fn(),
    claimWeeklyReportDelivery: vi.fn(),
    getWeeklyReportSettings: vi.fn(),
    setWeeklyReportSettings: vi.fn(),
    getEffectiveTierForUser: vi.fn(),
  },
}));

vi.mock("../../middleware/auth");

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

function report(id: number, weekStart: string, seen = false) {
  return createMockWeeklyReport({
    id,
    weekStart,
    weekEnd: weekStart,
    facts: createMockWeeklyFacts({
      weekStart,
      proteinDaysMet: id,
      daysActive: 5,
      recipesAdded: 1,
    }),
    content: createMockWeeklyReportContent({ headline: `Headline ${id}` }),
    source: "ai",
    seenAt: seen ? new Date("2026-11-15T19:00:00Z") : null,
  });
}

describe("Weekly report routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createApp();
    vi.clearAllMocks();
  });

  describe("GET /api/weekly-reports", () => {
    it("lists reports newest first with oldest-first trends, for a free user too", async () => {
      vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("free");
      vi.mocked(storage.listWeeklyReports).mockResolvedValue([
        report(3, "2026-11-08"),
        report(2, "2026-11-01", true),
        report(1, "2026-10-25", true),
      ]);
      const res = await request(app).get("/api/weekly-reports");
      expect(res.status).toBe(200);
      expect(res.body.reports).toEqual([
        {
          id: 3,
          weekStart: "2026-11-08",
          weekEnd: "2026-11-08",
          headline: "Headline 3",
          seen: false,
        },
        {
          id: 2,
          weekStart: "2026-11-01",
          weekEnd: "2026-11-01",
          headline: "Headline 2",
          seen: true,
        },
        {
          id: 1,
          weekStart: "2026-10-25",
          weekEnd: "2026-10-25",
          headline: "Headline 1",
          seen: true,
        },
      ]);
      expect(
        res.body.trends.map((t: { weekStart: string }) => t.weekStart),
      ).toEqual(["2026-10-25", "2026-11-01", "2026-11-08"]);
      expect(storage.listWeeklyReports).toHaveBeenCalledWith("1");
    });
  });

  describe("GET /api/weekly-reports/:id", () => {
    it("returns the caller's report", async () => {
      vi.mocked(storage.getWeeklyReport).mockResolvedValue(
        report(3, "2026-11-08"),
      );
      const res = await request(app).get("/api/weekly-reports/3");
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(3);
      expect(res.body.seenAt).toBeNull();
      expect(res.body).not.toHaveProperty("userId");
      expect(storage.getWeeklyReport).toHaveBeenCalledWith("1", 3);
    });

    it("404s another user's report", async () => {
      vi.mocked(storage.getWeeklyReport).mockResolvedValue(null);
      const res = await request(app).get("/api/weekly-reports/99");
      expect(res.status).toBe(404);
    });

    it("400s a non-numeric id", async () => {
      const res = await request(app).get("/api/weekly-reports/abc");
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/weekly-reports/pending-popup", () => {
    it("returns the pending report or null", async () => {
      vi.mocked(storage.getPendingPopup).mockResolvedValueOnce(
        report(3, "2026-11-08"),
      );
      const a = await request(app).get("/api/weekly-reports/pending-popup");
      expect(a.status).toBe(200);
      expect(a.body.report.id).toBe(3);
      vi.mocked(storage.getPendingPopup).mockResolvedValueOnce(null);
      const b = await request(app).get("/api/weekly-reports/pending-popup");
      expect(b.body).toEqual({ report: null });
    });
  });

  describe("POST marks", () => {
    it("popup-shown claims the popup once; a second claim is 409", async () => {
      vi.mocked(storage.getWeeklyReport).mockResolvedValue(
        report(3, "2026-11-08"),
      );
      vi.mocked(storage.claimWeeklyReportDelivery)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      const a = await request(app).post("/api/weekly-reports/3/popup-shown");
      const b = await request(app).post("/api/weekly-reports/3/popup-shown");
      expect(a.status).toBe(200);
      expect(b.status).toBe(409);
      expect(storage.claimWeeklyReportDelivery).toHaveBeenCalledWith(
        "1",
        3,
        "popup",
      );
    });

    it("seen and celebration-shown 404 for a report that isn't the caller's", async () => {
      vi.mocked(storage.getWeeklyReport).mockResolvedValue(null);
      expect(
        (await request(app).post("/api/weekly-reports/9/seen")).status,
      ).toBe(404);
      expect(
        (await request(app).post("/api/weekly-reports/9/celebration-shown"))
          .status,
      ).toBe(404);
      expect(storage.markWeeklyReportSeen).not.toHaveBeenCalled();
    });

    it("seen marks the caller's report", async () => {
      vi.mocked(storage.getWeeklyReport).mockResolvedValue(
        report(3, "2026-11-08"),
      );
      vi.mocked(storage.markWeeklyReportSeen).mockResolvedValue(true);
      const res = await request(app).post("/api/weekly-reports/3/seen");
      expect(res.status).toBe(200);
      expect(storage.markWeeklyReportSeen).toHaveBeenCalledWith("1", 3);
    });
  });

  describe("settings", () => {
    it("reads settings", async () => {
      vi.mocked(storage.getWeeklyReportSettings).mockResolvedValue({
        reportEnabled: true,
        pushEnabled: true,
      });
      const res = await request(app).get("/api/weekly-reports/settings");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ reportEnabled: true, pushEnabled: true });
    });

    it("updates a partial change", async () => {
      vi.mocked(storage.setWeeklyReportSettings).mockResolvedValue({
        reportEnabled: true,
        pushEnabled: false,
      });
      const res = await request(app)
        .put("/api/weekly-reports/settings")
        .send({ pushEnabled: false });
      expect(res.status).toBe(200);
      expect(storage.setWeeklyReportSettings).toHaveBeenCalledWith("1", {
        pushEnabled: false,
      });
    });

    it("rejects a bad body", async () => {
      const bad = await request(app)
        .put("/api/weekly-reports/settings")
        .send({ pushEnabled: "no" });
      const extra = await request(app)
        .put("/api/weekly-reports/settings")
        .send({ fibre: true });
      expect(bad.status).toBe(400);
      expect(extra.status).toBe(400);
      expect(storage.setWeeklyReportSettings).not.toHaveBeenCalled();
    });
  });
});
