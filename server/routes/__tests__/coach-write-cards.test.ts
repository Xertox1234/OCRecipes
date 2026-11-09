import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { storage } from "../../storage";
import {
  performWriteCardSave,
  revertWriteCardSave,
  afterWriteCardSave,
  WriteCardEditError,
} from "../../services/write-cards";
import { register } from "../coach-write-cards";
import { createMockCoachWriteCard } from "../../__tests__/factories";
import type { WriteCardTx } from "../../storage/coach-write-cards";

vi.mock("../../storage", () => ({
  storage: {
    saveWriteCard: vi.fn(),
    undoWriteCard: vi.fn(),
  },
}));

vi.mock("../../services/write-cards", async (orig) => {
  const actual = await orig<typeof import("../../services/write-cards")>();
  return {
    ...actual,
    performWriteCardSave: vi.fn(async () => ({ scannedItemIds: [1] })),
    revertWriteCardSave: vi.fn(async () => undefined),
    afterWriteCardSave: vi.fn(async () => undefined),
  };
});

vi.mock("../../middleware/auth");
vi.mock("express-rate-limit");

const CARD_ID = "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const tx = {} as WriteCardTx;

const foodCard = createMockCoachWriteCard({
  id: CARD_ID,
  userId: "1",
  kind: "food",
  status: "saved",
  payload: {
    items: [
      {
        name: "Large eggs",
        unitLabel: "egg",
        perUnit: { calories: 72, protein: 6, carbs: 0, fat: 5 },
        count: 2,
        source: "lookup",
      },
    ],
    mealType: "breakfast",
    day: "today",
  },
  edits: { counts: [3] },
  savedRefs: { scannedItemIds: [1] },
  savedAt: new Date(),
});

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

/** A saveWriteCard stand-in that runs the route's perform callback. */
function saveRunsPerform(
  status: "saved" | "already_saved" = "saved",
): typeof storage.saveWriteCard {
  return async (_id, _userId, perform) => {
    if (status === "saved") await perform(tx, { ...foodCard, status: "live" });
    return { status, card: foodCard };
  };
}

describe("coach write-card routes", () => {
  let app: express.Express;
  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe("POST /api/coach/cards/:id/save", () => {
    it("save route: 201 then 200 on repeat", async () => {
      vi.mocked(storage.saveWriteCard).mockImplementationOnce(
        saveRunsPerform("saved"),
      );
      const first = await request(app)
        .post(`/api/coach/cards/${CARD_ID}/save`)
        .set("X-Timezone", "America/Los_Angeles")
        .send({ edits: { counts: [3] } });
      expect(first.status).toBe(201);
      expect(first.body).toEqual({
        status: "saved",
        receipt: "✓ Logged to Breakfast · 216 cal",
      });
      expect(storage.saveWriteCard).toHaveBeenCalledWith(
        CARD_ID,
        "1",
        expect.any(Function),
        { counts: [3] },
      );
      expect(performWriteCardSave).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ id: CARD_ID }),
        { counts: [3] },
        expect.objectContaining({ userId: "1", tz: "America/Los_Angeles" }),
      );
      expect(afterWriteCardSave).toHaveBeenCalledTimes(1);

      vi.mocked(storage.saveWriteCard).mockImplementationOnce(
        saveRunsPerform("already_saved"),
      );
      const again = await request(app)
        .post(`/api/coach/cards/${CARD_ID}/save`)
        .send({ edits: { counts: [3] } });
      expect(again.status).toBe(200);
      expect(again.body).toEqual(first.body);
      expect(performWriteCardSave).toHaveBeenCalledTimes(1);
    });

    it("runs deferred index work only after the save resolves, and not when it throws", async () => {
      const order: string[] = [];
      vi.mocked(performWriteCardSave).mockImplementationOnce(
        async (_tx, _card, _edits, ctx) => {
          ctx.afterCommit?.(() => order.push("index"));
          return {};
        },
      );
      vi.mocked(storage.saveWriteCard).mockImplementationOnce(
        async (_id, _u, perform) => {
          await perform(tx, { ...foodCard, status: "live" });
          order.push("commit");
          return { status: "saved", card: foodCard };
        },
      );
      await request(app).post(`/api/coach/cards/${CARD_ID}/save`).send({});
      expect(order).toEqual(["commit", "index"]);

      const lost = vi.fn();
      vi.mocked(performWriteCardSave).mockImplementationOnce(
        async (_tx, _card, _edits, ctx) => {
          ctx.afterCommit?.(lost);
          throw new WriteCardEditError("Nothing to plan.");
        },
      );
      vi.mocked(storage.saveWriteCard).mockImplementationOnce(
        async (_id, _u, perform) => {
          await perform(tx, { ...foodCard, status: "live" });
          return { status: "saved", card: foodCard };
        },
      );
      await request(app).post(`/api/coach/cards/${CARD_ID}/save`).send({});
      expect(lost).not.toHaveBeenCalled();
    });

    it("save without edits uses the card's stored edits", async () => {
      vi.mocked(storage.saveWriteCard).mockImplementationOnce(
        async (_id, _u, perform) => {
          await perform(tx, {
            ...foodCard,
            status: "live",
            edits: { counts: [5] },
          });
          return { status: "saved", card: foodCard };
        },
      );
      await request(app).post(`/api/coach/cards/${CARD_ID}/save`).send({});
      expect(performWriteCardSave).toHaveBeenCalledWith(
        tx,
        expect.anything(),
        { counts: [5] },
        expect.anything(),
      );
      expect(vi.mocked(storage.saveWriteCard).mock.calls[0][3]).toBeUndefined();
    });

    it("save of a replaced card returns 409 and writes nothing", async () => {
      vi.mocked(storage.saveWriteCard).mockResolvedValueOnce({
        status: "locked",
        card: { ...foodCard, status: "replaced" },
      });
      const res = await request(app)
        .post(`/api/coach/cards/${CARD_ID}/save`)
        .send({ edits: {} });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("CARD_LOCKED");
      expect(performWriteCardSave).not.toHaveBeenCalled();
      expect(afterWriteCardSave).not.toHaveBeenCalled();
    });

    it("save of another user's card returns 404", async () => {
      vi.mocked(storage.saveWriteCard).mockResolvedValueOnce({
        status: "not_found",
      });
      const res = await request(app)
        .post(`/api/coach/cards/${CARD_ID}/save`)
        .send({ edits: {} });
      expect(res.status).toBe(404);
    });

    it("save with calories in edits returns 400", async () => {
      vi.mocked(performWriteCardSave).mockRejectedValueOnce(
        new WriteCardEditError("These changes can't be saved."),
      );
      vi.mocked(storage.saveWriteCard).mockImplementationOnce(
        saveRunsPerform("saved"),
      );
      const res = await request(app)
        .post(`/api/coach/cards/${CARD_ID}/save`)
        .send({ edits: { calories: 900 } });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: "These changes can't be saved.",
        code: "VALIDATION_ERROR",
      });
    });

    it("rejects a malformed card id and extra body keys", async () => {
      expect(
        (await request(app).post("/api/coach/cards/42/save").send({})).status,
      ).toBe(400);
      expect(
        (
          await request(app)
            .post(`/api/coach/cards/${CARD_ID}/save`)
            .send({ edits: {}, payload: { items: [] } })
        ).status,
      ).toBe(400);
      expect(storage.saveWriteCard).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/coach/cards/:id/undo", () => {
    it("undoes a recent save", async () => {
      vi.mocked(storage.undoWriteCard).mockImplementationOnce(
        async (_id, _u, revert) => {
          await revert(tx, foodCard);
          return { status: "undone", card: { ...foodCard, status: "live" } };
        },
      );
      const res = await request(app).post(`/api/coach/cards/${CARD_ID}/undo`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "live" });
      expect(revertWriteCardSave).toHaveBeenCalledWith(
        tx,
        foodCard,
        expect.any(Function),
      );
    });

    it("undo runs deferred index work after the undo resolves", async () => {
      const order: string[] = [];
      vi.mocked(revertWriteCardSave).mockImplementationOnce(
        async (_tx, _card, afterCommit) => {
          afterCommit?.(() => order.push("index"));
        },
      );
      vi.mocked(storage.undoWriteCard).mockImplementationOnce(
        async (_id, _u, revert) => {
          await revert(tx, foodCard);
          order.push("commit");
          return { status: "undone", card: { ...foodCard, status: "live" } };
        },
      );
      await request(app).post(`/api/coach/cards/${CARD_ID}/undo`);
      expect(order).toEqual(["commit", "index"]);
    });

    it("undo route returns 409 UNDO_EXPIRED after 60s", async () => {
      vi.mocked(storage.undoWriteCard).mockResolvedValueOnce({
        status: "too_late",
      });
      const res = await request(app).post(`/api/coach/cards/${CARD_ID}/undo`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("UNDO_EXPIRED");
    });

    it("undo of an unsaved card is 409, and of another user's card 404", async () => {
      vi.mocked(storage.undoWriteCard).mockResolvedValueOnce({
        status: "not_saved",
      });
      expect(
        (await request(app).post(`/api/coach/cards/${CARD_ID}/undo`)).body.code,
      ).toBe("CARD_NOT_SAVED");
      vi.mocked(storage.undoWriteCard).mockResolvedValueOnce({
        status: "not_found",
      });
      expect(
        (await request(app).post(`/api/coach/cards/${CARD_ID}/undo`)).status,
      ).toBe(404);
    });
  });
});
