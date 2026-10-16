// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
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
] as const;

function mockProfile(profile: unknown) {
  mockApiRequest.mockResolvedValue({ json: async () => profile });
}

/** The live `checked` property of each row's switch (the attribute is stale). */
function switchStates() {
  return Object.fromEntries(
    LABELS.map((label) => {
      const input = screen
        .getByRole("switch", { name: label })
        .querySelector("input") as HTMLInputElement;
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
        (
          screen
            .getByRole("switch", { name: LABELS[0] })
            .querySelector("input") as HTMLInputElement
        ).disabled,
      ).toBe(false),
    );
    expect(
      screen.queryByText("Couldn't load your reminder settings."),
    ).toBeNull();
    expect(switchStates()).toEqual({
      "Meal logging nudges": true,
      "Commitment follow-ups": true,
      "Daily check-in": true,
    });
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
    });
  });
});
