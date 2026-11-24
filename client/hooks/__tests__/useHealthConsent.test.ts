// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { useHealthConsent } from "../useHealthConsent";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest, mockClearReminders } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
  mockClearReminders: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));
vi.mock("@/hooks/useNotebookNotifications", () => ({
  clearScheduledCoachReminders: () => mockClearReminders(),
}));

// Owner ruling 2026-11-24 (coach chat audit M52).
describe("useHealthConsent withdraw", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiRequest.mockResolvedValue({ json: () => Promise.resolve({}) });
    mockClearReminders.mockResolvedValue(true);
  });

  it.each(["delete", "keep"] as const)(
    "sends the notes choice %s",
    async (choice) => {
      const { wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useHealthConsent(), { wrapper });

      await act(() => result.current.withdraw(choice));

      expect(mockApiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/user/health-consent/withdraw",
        { coachNotes: choice },
      );
    },
  );

  // The device schedules commitment reminders itself, with the note's text.
  it("cancels the reminders this device scheduled", async () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useHealthConsent(), { wrapper });

    await act(() => result.current.withdraw("keep"));

    expect(mockClearReminders).toHaveBeenCalledTimes(1);
  });

  it("leaves the reminders alone when the withdrawal fails", async () => {
    mockApiRequest.mockImplementation((method: string) =>
      method === "POST"
        ? Promise.reject(new Error("offline"))
        : Promise.resolve({ json: () => Promise.resolve({}) }),
    );
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useHealthConsent(), { wrapper });

    await expect(act(() => result.current.withdraw("keep"))).rejects.toThrow(
      "offline",
    );
    expect(mockClearReminders).not.toHaveBeenCalled();
  });
});
