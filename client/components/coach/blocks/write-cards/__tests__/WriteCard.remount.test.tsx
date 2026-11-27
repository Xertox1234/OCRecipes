// @vitest-environment jsdom
import React, { useState } from "react";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderComponent } from "../../../../../../test/utils/render-component";
import WriteCard from "../WriteCard";
import type {
  WriteCardBlock,
  WriteCardEdits,
} from "@shared/schemas/coach-write-cards";

// Coach chat audit 2026-11-24, L34: a finished reply's card first renders in
// the streaming footer, then the saved message row takes over, and the card
// remounts. What the user did on the first copy must carry to the second.

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

const CARD_ID = "7a2c3b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const RECEIPT = "✓ Logged to Breakfast · 72 cal";

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
        count: 1,
        source: "lookup",
      },
    ],
    mealType: "breakfast",
    day: "today",
  },
  ...overrides,
});

function Harness({ initial }: { initial: WriteCardBlock }) {
  const [edits, setEdits] = useState<WriteCardEdits>({});
  return <WriteCard block={initial} edits={edits} onEdit={setEdits} />;
}

const ok = (body: unknown) => ({ json: async () => body });

function deferred() {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("WriteCard keeps what the user did across a remount (L34)", () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
  });

  it("keeps Undo after a save when the saved row takes over", async () => {
    mockApiRequest.mockResolvedValue(ok({ status: "saved", receipt: RECEIPT }));
    const first = renderComponent(<Harness initial={block()} />);
    fireEvent.click(screen.getByRole("button", { name: "Log 72 cal" }));
    await screen.findByRole("button", { name: "Undo" });
    first.unmount();

    // The saved row: the refetch already says saved.
    renderComponent(
      <Harness initial={block({ status: "saved", receipt: RECEIPT })} />,
    );
    expect(screen.getByRole("button", { name: "Undo" })).toBeDefined();
  });

  it("a save still in flight lands in the new copy, and a second tap does not save again", async () => {
    const save = deferred();
    mockApiRequest.mockReturnValue(save.promise);
    const first = renderComponent(<Harness initial={block()} />);
    fireEvent.click(screen.getByRole("button", { name: "Log 72 cal" }));
    first.unmount();

    renderComponent(<Harness initial={block()} />);
    const button = screen.queryByRole("button", { name: "Log 72 cal" });
    if (button) fireEvent.click(button);
    expect(mockApiRequest).toHaveBeenCalledTimes(1);

    await act(async () => {
      save.resolve(ok({ status: "saved", receipt: RECEIPT }));
    });
    await waitFor(() => expect(screen.getByText(RECEIPT)).toBeDefined());
    expect(screen.getByRole("button", { name: "Undo" })).toBeDefined();
  });

  it("a save that fails in flight shows its error in the new copy", async () => {
    const save = deferred();
    mockApiRequest.mockReturnValue(save.promise);
    const first = renderComponent(<Harness initial={block()} />);
    fireEvent.click(screen.getByRole("button", { name: "Log 72 cal" }));
    first.unmount();

    renderComponent(<Harness initial={block()} />);
    await act(async () => {
      save.reject(new TypeError("Network request failed"));
    });
    expect(
      await screen.findByText(
        "Couldn't save. Check your connection and try again.",
      ),
    ).toBeDefined();
  });

  it("a newer server status wins over what this device did", async () => {
    mockApiRequest.mockResolvedValue(ok({ status: "saved", receipt: RECEIPT }));
    const first = renderComponent(<Harness initial={block()} />);
    fireEvent.click(screen.getByRole("button", { name: "Log 72 cal" }));
    await screen.findByRole("button", { name: "Undo" });
    first.unmount();

    renderComponent(<Harness initial={block({ status: "replaced" })} />);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });
});
