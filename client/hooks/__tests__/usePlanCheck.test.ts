// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";

import { PLAN_CHECKING_MESSAGE, usePlanCheck } from "../usePlanCheck";

const { mockPlan, mockRefresh, mockInfo } = vi.hoisted(() => ({
  mockPlan: { resolved: true },
  mockRefresh: vi.fn(() => Promise.resolve()),
  mockInfo: vi.fn(),
}));

vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({
    isPremiumResolved: mockPlan.resolved,
    refreshSubscription: mockRefresh,
  }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ info: mockInfo }),
}));

describe("usePlanCheck", () => {
  beforeEach(() => {
    mockPlan.resolved = true;
  });

  it("reports the plan as known once the status has resolved", () => {
    const { result } = renderHook(() => usePlanCheck());
    expect(result.current.planUnknown).toBe(false);
  });

  it("reports the plan as unknown while the status is loading or failed", () => {
    mockPlan.resolved = false;
    const { result } = renderHook(() => usePlanCheck());
    expect(result.current.planUnknown).toBe(true);
  });

  it("recheckPlan re-fetches the plan and tells the user to try again", () => {
    mockPlan.resolved = false;
    const { result } = renderHook(() => usePlanCheck());
    result.current.recheckPlan();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockInfo).toHaveBeenCalledWith(PLAN_CHECKING_MESSAGE);
    expect(PLAN_CHECKING_MESSAGE).toBe(
      "Checking your plan. Try again in a moment.",
    );
  });
});
