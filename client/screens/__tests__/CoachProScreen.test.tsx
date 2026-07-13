// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import CoachProScreen from "../CoachProScreen";

const { mockAcknowledge } = vi.hoisted(() => ({
  mockAcknowledge: vi.fn(),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn(), setParams: vi.fn() }),
  useRoute: () => ({ params: {} }),
}));

vi.mock("@react-navigation/bottom-tabs", () => ({
  useBottomTabBarHeight: () => 0,
}));

vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({ isLoading: false }),
}));

vi.mock("@/hooks/usePremiumFeatures", () => ({
  usePremiumFeature: () => true,
}));

vi.mock("@/hooks/useCoachContext", () => ({
  useCoachContext: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
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
// CoachChat's own internals (already covered by CoachChat.test.tsx).
vi.mock("@/components/coach/CoachChat", () => ({
  default: ({ onMessageSent }: { onMessageSent?: () => void }) => (
    <button onClick={() => onMessageSent?.()}>mock-send</button>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockAcknowledge.mockResolvedValue(undefined);
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
