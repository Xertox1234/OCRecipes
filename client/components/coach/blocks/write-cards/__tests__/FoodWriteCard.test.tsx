// @vitest-environment jsdom
import React, { useState } from "react";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderComponent } from "../../../../../../test/utils/render-component";
import WriteCard from "../WriteCard";
import type {
  WriteCardBlock,
  WriteCardEdits,
} from "@shared/schemas/coach-write-cards";

const { mockApiRequest } = vi.hoisted(() => ({ mockApiRequest: vi.fn() }));
vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));
vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    selection: vi.fn(),
    impact: vi.fn(),
    notification: vi.fn(),
  }),
}));

const CARD_ID = "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

const block = (overrides: Partial<WriteCardBlock> = {}): WriteCardBlock => ({
  type: "write_card",
  cardId: CARD_ID,
  kind: "food",
  status: "live",
  payload: {
    items: [
      {
        name: "Large eggs",
        unitLabel: "egg",
        perUnit: { calories: 72, protein: 6, carbs: 0, fat: 5 },
        count: 2,
        source: "lookup",
      },
      {
        name: "Whole-wheat toast",
        unitLabel: "slice",
        perUnit: { calories: 82, protein: 4, carbs: 14, fat: 1 },
        count: 1,
        source: "estimate",
      },
    ],
    mealType: "breakfast",
    day: "today",
  },
  ...overrides,
});

/** The chat owns the edits; this harness plays that part. */
function Harness({ initial }: { initial: WriteCardBlock }) {
  const [edits, setEdits] = useState<WriteCardEdits>({});
  return <WriteCard block={initial} edits={edits} onEdit={setEdits} />;
}

const ok = (body: unknown) => ({ json: async () => body });

describe("FoodWriteCard", () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('FoodWriteCard shows "Log 226 cal" and updates to "Log 298 cal" after + on eggs', () => {
    renderComponent(<Harness initial={block()} />);
    expect(screen.getByRole("button", { name: "Log 226 cal" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "More Large eggs" }));
    expect(screen.getByRole("button", { name: "Log 298 cal" })).toBeDefined();
  });

  it("tapping save calls save with counts only", async () => {
    mockApiRequest.mockResolvedValue(
      ok({ status: "saved", receipt: "✓ Logged to Breakfast · 298 cal" }),
    );
    renderComponent(<Harness initial={block()} />);
    fireEvent.click(screen.getByRole("button", { name: "More Large eggs" }));
    fireEvent.click(screen.getByRole("button", { name: "Log 298 cal" }));
    await waitFor(() =>
      expect(screen.getByText("✓ Logged to Breakfast · 298 cal")).toBeDefined(),
    );
    expect(mockApiRequest).toHaveBeenCalledWith(
      "POST",
      `/api/coach/cards/${CARD_ID}/save`,
      { edits: { counts: [3, 1] } },
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Timezone": expect.any(String) }),
      }),
    );
  });

  it("saved shows Undo, then hides it after 6s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockApiRequest.mockResolvedValue(
      ok({ status: "saved", receipt: "✓ Logged to Breakfast · 226 cal" }),
    );
    renderComponent(<Harness initial={block()} />);
    fireEvent.click(screen.getByRole("button", { name: "Log 226 cal" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Undo" })).toBeDefined(),
    );
    await act(async () => {
      vi.advanceTimersByTime(6100);
    });
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.getByText("✓ Logged to Breakfast · 226 cal")).toBeDefined();
  });

  it("Undo puts the card back to live", async () => {
    mockApiRequest
      .mockResolvedValueOnce(
        ok({ status: "saved", receipt: "✓ Logged to Breakfast · 226 cal" }),
      )
      .mockResolvedValueOnce(ok({ status: "live" }));
    renderComponent(<Harness initial={block()} />);
    fireEvent.click(screen.getByRole("button", { name: "Log 226 cal" }));
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(
      await screen.findByRole("button", { name: "Log 226 cal" }),
    ).toBeDefined();
    expect(mockApiRequest).toHaveBeenLastCalledWith(
      "POST",
      `/api/coach/cards/${CARD_ID}/undo`,
    );
  });

  it("a failed save keeps the card editable with a retry", async () => {
    mockApiRequest.mockRejectedValueOnce(
      new TypeError("Network request failed"),
    );
    renderComponent(<Harness initial={block()} />);
    fireEvent.click(screen.getByRole("button", { name: "Log 226 cal" }));
    expect(
      await screen.findByText(
        "Couldn't save. Check your connection and try again.",
      ),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Log 226 cal" })).toBeDefined();
    expect(
      (
        screen.getByRole("button", { name: "More Large eggs" }) as HTMLElement
      ).getAttribute("aria-disabled"),
    ).not.toBe("true");
  });

  it("replaced card has no enabled buttons", () => {
    renderComponent(<Harness initial={block({ status: "replaced" })} />);
    expect(screen.getByText("Replaced")).toBeDefined();
    for (const b of screen.queryAllByRole("button")) {
      expect(b.getAttribute("aria-disabled")).toBe("true");
    }
    expect(screen.queryByRole("button", { name: "Log 226 cal" })).toBeNull();
  });

  it("a card saved earlier shows its receipt without Undo", () => {
    renderComponent(
      <Harness
        initial={block({
          status: "saved",
          receipt: "✓ Logged to Lunch · 298 cal",
        })}
      />,
    );
    expect(screen.getByText("✓ Logged to Lunch · 298 cal")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("meal and day chips are radios and change the edits", () => {
    renderComponent(<Harness initial={block()} />);
    const lunch = screen.getByRole("radio", { name: "Lunch" });
    fireEvent.click(lunch);
    expect(lunch.getAttribute("aria-checked")).toBe("true");
    expect(
      screen
        .getByRole("radio", { name: "Yesterday" })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });
});

describe("FoodWriteCard after a newer card", () => {
  it("a card saved here still locks when a refetch says it was replaced", async () => {
    mockApiRequest.mockResolvedValue(
      ok({ status: "saved", receipt: "✓ Logged to Breakfast · 226 cal" }),
    );
    function Swap() {
      const [b, setB] = useState(block());
      return (
        <>
          <WriteCard block={b} edits={{}} onEdit={() => {}} />
          <button onClick={() => setB({ ...b, status: "replaced" })}>
            refetch
          </button>
        </>
      );
    }
    renderComponent(<Swap />);
    fireEvent.click(screen.getByRole("button", { name: "Log 226 cal" }));
    await screen.findByText("✓ Logged to Breakfast · 226 cal");
    fireEvent.click(screen.getByText("refetch"));
    expect(screen.getByText("Replaced")).toBeDefined();
  });
});
