// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import TastePicksScreen from "../onboarding/TastePicksScreen";

const {
  mockApiRequest,
  mockUpdateUser,
  mockToastSuccess,
  mockToastError,
  mockAlert,
} = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
  mockUpdateUser: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
  mockAlert: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({ apiRequest: mockApiRequest }));
vi.mock("@/context/AuthContext", () => ({
  useAuthContext: () => ({ updateUser: mockUpdateUser }),
}));
vi.mock("@/context/OnboardingContext", () => ({
  useOnboarding: () => ({ data: { dietType: null }, prevStep: vi.fn() }),
}));
vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({
    success: mockToastSuccess,
    error: mockToastError,
    info: vi.fn(),
  }),
}));
// Stand-in grid: one button picks every candidate, so Continue unlocks
// without driving the real FlatList.
vi.mock("@/components/TastePicksGrid", () => ({
  TastePicksGrid: ({
    candidates,
    onToggle,
  }: {
    candidates: { id: number }[];
    onToggle: (id: number) => void;
  }) =>
    React.createElement(
      "button",
      { onClick: () => candidates.forEach((c) => onToggle(c.id)) },
      `Pick all ${candidates.length}`,
    ),
}));
vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  return { ...actual, Alert: { alert: mockAlert } };
});

const CELEBRATION = "You're all set — let's get cooking!";

const candidates = [1, 2, 3, 4, 5].map((id) => ({
  id,
  title: `Recipe ${id}`,
  imageUrl: "",
  cuisineOrigin: null,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockApiRequest.mockImplementation(async (method: string) => ({
    json: async () =>
      method === "GET" ? { candidates, total: 5, page: 1 } : {},
  }));
  mockUpdateUser.mockResolvedValue({ onboardingCompleted: true });
});

async function pickFive() {
  fireEvent.click(await screen.findByRole("button", { name: "Pick all 5" }));
}

describe("TastePicksScreen — finishing onboarding", () => {
  it("celebrates once when the user continues with their picks", async () => {
    renderComponent(<TastePicksScreen />);
    await pickFive();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith(CELEBRATION),
    );
    expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    expect(mockApiRequest).toHaveBeenCalledWith("PUT", "/api/taste-picks", {
      recipeIds: [1, 2, 3, 4, 5],
    });
    expect(mockUpdateUser).toHaveBeenCalledWith({ onboardingCompleted: true });
  });

  it("celebrates once when the user skips the picks", async () => {
    renderComponent(<TastePicksScreen />);
    await screen.findByRole("button", { name: "Pick all 5" });

    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));

    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith(CELEBRATION),
    );
    expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    expect(mockUpdateUser).toHaveBeenCalledWith({ onboardingCompleted: true });
  });

  it.each([
    ["Continue", true],
    ["Skip for now", false],
  ])(
    "does not celebrate when %s fails, and says so with an error toast",
    async (label, needsPicks) => {
      mockUpdateUser.mockRejectedValue(new Error("PUT /api/auth/profile 500"));
      renderComponent(<TastePicksScreen />);
      if (needsPicks) await pickFive();
      else await screen.findByRole("button", { name: "Pick all 5" });

      fireEvent.click(screen.getByRole("button", { name: label }));

      await waitFor(() =>
        expect(mockToastError).toHaveBeenCalledWith(
          "Something went wrong. Please try again.",
        ),
      );
      expect(mockToastSuccess).not.toHaveBeenCalled();
      expect(mockAlert).not.toHaveBeenCalled();
    },
  );
});
