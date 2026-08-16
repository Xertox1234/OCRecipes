// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import CoachProScreen from "../CoachProScreen";

const {
  mockAcknowledge,
  mockUsePremiumFeature,
  mockUseCoachContext,
  premiumContextState,
} = vi.hoisted(() => ({
  mockAcknowledge: vi.fn(),
  mockUsePremiumFeature: vi.fn(),
  mockUseCoachContext: vi.fn(),
  premiumContextState: { isLoading: false },
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn(), setParams: vi.fn() }),
  useRoute: () => ({ params: {} }),
}));

vi.mock("@react-navigation/bottom-tabs", () => ({
  useBottomTabBarHeight: () => 0,
}));

vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => premiumContextState,
}));

vi.mock("@/hooks/usePremiumFeatures", () => ({
  usePremiumFeature: mockUsePremiumFeature,
}));

vi.mock("@/hooks/useCoachContext", () => ({
  useCoachContext: mockUseCoachContext,
}));

vi.mock("@/hooks/useChat", () => ({
  useCreateConversation: () => ({ mutateAsync: vi.fn() }),
  useChatConversations: () => ({ data: [], isError: false, refetch: vi.fn() }),
  useNotebookEntries: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/hooks/useNotebookNotifications", () => ({
  useNotebookNotifications: () => ({
    cancelStaleReminders: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/hooks/useCoachWarmUp", () => ({
  useCoachWarmUp: () => ({
    sendWarmUp: vi.fn(),
    sendTextWarmUp: vi.fn(),
    getWarmUpId: () => null,
    reset: vi.fn(),
  }),
}));

vi.mock("@/hooks/useAcknowledgeReminders", () => ({
  useAcknowledgeReminders: () => ({ acknowledge: mockAcknowledge }),
}));

// Thin CoachChat double — isolates CoachProScreen's onMessageSent wiring from
// CoachChat's own internals (already covered by CoachChat.test.tsx). Renders
// the isCoachPro prop so the gate tests can observe the downgrade plumbing.
vi.mock("@/components/coach/CoachChat", () => ({
  default: ({
    onMessageSent,
    isCoachPro,
  }: {
    onMessageSent?: () => void;
    isCoachPro?: boolean;
  }) => (
    <>
      <button onClick={() => onMessageSent?.()}>mock-send</button>
      <div>{`coach-pro:${String(isCoachPro)}`}</div>
    </>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockAcknowledge.mockResolvedValue(undefined);
  // Defaults preserve the original harness: Coach Pro user, premium resolved.
  premiumContextState.isLoading = false;
  mockUsePremiumFeature.mockReturnValue(true);
  mockUseCoachContext.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
});

describe("CoachProScreen — reminder acknowledgment", () => {
  it("does not acknowledge reminders on mount", () => {
    renderComponent(<CoachProScreen />);
    expect(mockAcknowledge).not.toHaveBeenCalled();
  });

  it("acknowledges reminders once a message is sent", () => {
    renderComponent(<CoachProScreen />);
    fireEvent.click(screen.getByText("mock-send"));

    expect(mockAcknowledge).toHaveBeenCalledOnce();
  });

  it("does not acknowledge again on a second send in the same session", () => {
    renderComponent(<CoachProScreen />);
    const sendButton = screen.getByText("mock-send");

    fireEvent.click(sendButton);
    fireEvent.click(sendButton);

    expect(mockAcknowledge).toHaveBeenCalledOnce();
  });
});

describe("CoachProScreen — premium gate (coachPro)", () => {
  // The screen has no redirect/paywall (the navigator is the access gate);
  // its own gate behavior is (a) disabling the premium /api/coach/context
  // fetch for confirmed-free users and (b) downgrading CoachChat.
  it("free tier with premium resolved: disables the coach-context fetch and downgrades CoachChat", () => {
    mockUsePremiumFeature.mockReturnValue(false);

    renderComponent(<CoachProScreen />);

    expect(mockUsePremiumFeature).toHaveBeenCalledWith("coachPro");
    expect(mockUseCoachContext).toHaveBeenCalledWith(false);
    expect(screen.getByText("coach-pro:false")).toBeTruthy();
  });

  it("Coach Pro user: enables the coach-context fetch and passes isCoachPro (non-vacuity control)", () => {
    renderComponent(<CoachProScreen />);

    expect(mockUseCoachContext).toHaveBeenCalledWith(true);
    expect(screen.getByText("coach-pro:true")).toBeTruthy();
  });

  it("keeps the context fetch enabled while premium status is still loading", () => {
    // contextEnabled = isCoachPro || isPremiumLoading — the screen is only
    // mounted for Pro users, so it assumes access until premium resolves
    // rather than flashing a disabled fetch.
    mockUsePremiumFeature.mockReturnValue(false);
    premiumContextState.isLoading = true;

    renderComponent(<CoachProScreen />);

    expect(mockUseCoachContext).toHaveBeenCalledWith(true);
  });
});
