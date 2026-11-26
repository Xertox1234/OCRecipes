// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import CoachRemindersScreen from "../CoachRemindersScreen";

const { mockApiRequest } = vi.hoisted(() => ({ mockApiRequest: vi.fn() }));

vi.mock("@/lib/query-client", () => ({ apiRequest: mockApiRequest }));
vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

const LABELS = [
  "Meal logging nudges",
  "Commitment follow-ups",
  "Daily check-in",
  "Expiring food",
] as const;

function mockProfile(profile: unknown) {
  mockApiRequest.mockResolvedValue({ json: async () => profile });
}

/** The live `checked` property of each row's switch (the attribute is stale). */
function switchStates() {
  return Object.fromEntries(
    LABELS.map((label) => {
      const input = screen.getByRole("switch", {
        name: label,
      }) as HTMLInputElement;
      return [label, input.checked];
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CoachRemindersScreen", () => {
  it("shows every reminder on when the user has no dietary profile", async () => {
    mockProfile(null);
    renderComponent(<CoachRemindersScreen />);

    // Switches are enabled only once the query has settled successfully.
    await waitFor(() =>
      expect(
        (screen.getByRole("switch", { name: LABELS[0] }) as HTMLInputElement)
          .disabled,
      ).toBe(false),
    );
    expect(
      screen.queryByText("Couldn't load your reminder settings."),
    ).toBeNull();
    expect(switchStates()).toEqual({
      "Meal logging nudges": true,
      "Commitment follow-ups": true,
      "Daily check-in": true,
      "Expiring food": true,
    });
  });

  // A non-pressable View with role "switch" around the real Switch made
  // VoiceOver announce a switch whose double-tap did nothing (audit
  // 2026-11-06 C2). The named switch must be the Switch control itself.
  it("each named switch is the Switch control, not a row wrapper around it", async () => {
    mockProfile(null);
    renderComponent(<CoachRemindersScreen />);

    await waitFor(() => screen.getAllByRole("switch"));
    const meal = screen.getByRole("switch", { name: LABELS[0] });
    expect(meal.textContent).not.toContain(LABELS[0]);
    expect(meal.textContent).not.toContain("Reminder at noon");
  });

  it("shows the expiring-food nudge as off when the user muted it", async () => {
    mockProfile({ reminderMutes: { "pantry-expiring": true } });
    renderComponent(<CoachRemindersScreen />);

    await waitFor(() => expect(switchStates()["Expiring food"]).toBe(false));
  });

  it("shows a muted category as off", async () => {
    mockProfile({ reminderMutes: { commitment: true } });
    renderComponent(<CoachRemindersScreen />);

    await waitFor(() =>
      expect(switchStates()["Commitment follow-ups"]).toBe(false),
    );
    expect(switchStates()).toEqual({
      "Meal logging nudges": true,
      "Commitment follow-ups": false,
      "Daily check-in": true,
      "Expiring food": true,
    });
  });
});

// Coach chat audit 2026-11-24 L31: the switch read only the server copy, and
// the mutation finished before the refetch landed, so a tapped switch flipped
// back to its old position and then over again; while loading, every switch
// showed "on".
describe("CoachRemindersScreen — a toggle holds its new position", () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
  const json = (body: unknown) => ({ json: async () => body });

  it("shows the new value at once and keeps it until the server copy arrives", async () => {
    const patch = deferred<unknown>();
    const refetch = deferred<unknown>();
    let gets = 0;
    mockApiRequest.mockImplementation((method: string) => {
      if (method === "PATCH") return patch.promise;
      gets += 1;
      return gets === 1 ? Promise.resolve(json(null)) : refetch.promise;
    });
    renderComponent(<CoachRemindersScreen />);
    await waitFor(() => expect(switchStates()[LABELS[0]]).toBe(true));

    fireEvent.click(screen.getByRole("switch", { name: LABELS[0] }));
    // TanStack posts the pending state a tick later.
    await waitFor(() => expect(switchStates()[LABELS[0]]).toBe(false));

    // The save lands; the refetch is still in flight.
    await act(async () => {
      patch.resolve(json({ reminderMutes: { "meal-log": true } }));
      // Let TanStack's scheduled state updates run (it notifies on a timer).
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(switchStates()[LABELS[0]]).toBe(false);

    await act(async () => {
      refetch.resolve(json({ reminderMutes: { "meal-log": true } }));
    });
    await waitFor(() => expect(switchStates()[LABELS[0]]).toBe(false));
  });

  it("goes back when the save fails", async () => {
    const patch = deferred<unknown>();
    mockApiRequest.mockImplementation((method: string) =>
      method === "PATCH" ? patch.promise : Promise.resolve(json(null)),
    );
    renderComponent(<CoachRemindersScreen />);
    await waitFor(() => expect(switchStates()[LABELS[0]]).toBe(true));

    fireEvent.click(screen.getByRole("switch", { name: LABELS[0] }));
    // TanStack posts the pending state a tick later.
    await waitFor(() => expect(switchStates()[LABELS[0]]).toBe(false));
    await act(async () => {
      patch.reject(new Error("offline"));
    });
    await waitFor(() => expect(switchStates()[LABELS[0]]).toBe(true));
  });

  it("shows a loading state, not switches that all read on", () => {
    mockApiRequest.mockImplementation(() => new Promise(() => {}));
    renderComponent(<CoachRemindersScreen />);
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });
});
