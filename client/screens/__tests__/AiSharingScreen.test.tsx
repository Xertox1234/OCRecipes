// @vitest-environment jsdom
import React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { AI_RECIPIENTS, AI_SHARED_DATA } from "@shared/lib/ai-sharing";

import { renderComponent } from "../../../test/utils/render-component";
import AiSharingScreen from "../AiSharingScreen";

const { mockAnswer, mockToast, nav } = vi.hoisted(() => ({
  mockAnswer: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  nav: { canGoBack: vi.fn(), goBack: vi.fn() },
}));

vi.mock("@/hooks/useAiSharing", () => ({
  useAiSharing: () => ({ status: undefined, answer: mockAnswer }),
}));
vi.mock("@/context/ToastContext", () => ({ useToast: () => mockToast }));
vi.mock("@react-navigation/native", () => ({ useNavigation: () => nav }));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

// Privacy audit H3: the app names the AI companies and asks before sending.
describe("AiSharingScreen", () => {
  beforeEach(() => {
    mockAnswer.mockReset().mockResolvedValue(undefined);
    nav.canGoBack.mockReset().mockReturnValue(false);
    nav.goBack.mockReset();
    mockToast.info.mockReset();
    mockToast.error.mockReset();
  });

  it("names every recipient and everything that is sent", () => {
    renderComponent(<AiSharingScreen />);

    for (const { name } of AI_RECIPIENTS) {
      expect(screen.getByText(name)).toBeDefined();
    }
    for (const item of AI_SHARED_DATA) {
      expect(screen.getByText(`• ${item}`)).toBeDefined();
    }
  });

  it("records a yes", async () => {
    renderComponent(<AiSharingScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Allow AI features" }));

    await waitFor(() => expect(mockAnswer).toHaveBeenCalledWith(true));
    expect(nav.goBack).not.toHaveBeenCalled();
  });

  it("records a no", async () => {
    renderComponent(<AiSharingScreen />);

    fireEvent.click(
      screen.getByRole("button", { name: "Keep AI features off" }),
    );

    await waitFor(() => expect(mockAnswer).toHaveBeenCalledWith(false));
  });

  it("closes itself when it was opened on top of the app", async () => {
    nav.canGoBack.mockReturnValue(true);
    renderComponent(<AiSharingScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Allow AI features" }));

    await waitFor(() => expect(nav.goBack).toHaveBeenCalledTimes(1));
  });

  // Owner ruling 2026-11-10: a new account is asked as an onboarding step.
  describe("as an onboarding step", () => {
    it("moves to the next step once the answer is saved", async () => {
      const onAnswered = vi.fn();
      nav.canGoBack.mockReturnValue(true);
      renderComponent(<AiSharingScreen onAnswered={onAnswered} />);

      fireEvent.click(
        screen.getByRole("button", { name: "Keep AI features off" }),
      );

      await waitFor(() => expect(onAnswered).toHaveBeenCalledTimes(1));
      expect(mockAnswer).toHaveBeenCalledWith(false);
      expect(nav.goBack).not.toHaveBeenCalled();
    });

    // The only onboarding screen that saves mid-flow: a failed save must not
    // strand a new account. AI stays off on the server until a yes is saved.
    it("moves on when the answer cannot be saved, and says where to find it", async () => {
      const onAnswered = vi.fn();
      mockAnswer.mockRejectedValue(new Error("offline"));
      renderComponent(<AiSharingScreen onAnswered={onAnswered} />);

      fireEvent.click(
        screen.getByRole("button", { name: "Allow AI features" }),
      );

      await waitFor(() => expect(onAnswered).toHaveBeenCalledTimes(1));
      expect(mockToast.info).toHaveBeenCalledWith(
        expect.stringContaining("Settings"),
      );
    });
  });

  it("stays put and says so when the answer cannot be saved", async () => {
    mockAnswer.mockRejectedValue(new Error("offline"));
    nav.canGoBack.mockReturnValue(true);
    renderComponent(<AiSharingScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Allow AI features" }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledTimes(1));
    expect(nav.goBack).not.toHaveBeenCalled();
  });
});
