// @vitest-environment jsdom
import { renderHook, waitFor, act } from "@testing-library/react";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";
import { ApiError } from "@/lib/api-error";
import { ErrorCode } from "@shared/constants/error-codes";
import { useFamilySwitch } from "../useFamilySwitch";

const { mockApiRequest, mockState, mockNavigate, mockSelection, mockToast } =
  vi.hoisted(() => ({
    mockApiRequest: vi.fn(),
    mockState: { flag: true, planUnknown: false },
    mockNavigate: vi.fn(),
    mockSelection: vi.fn(),
    mockToast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
  }));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));
vi.mock("@/hooks/usePremiumFeatures", () => ({
  usePremiumFeature: () => mockState.flag,
}));
vi.mock("@/hooks/usePlanCheck", () => ({
  usePlanCheck: () => ({
    planUnknown: mockState.planUnknown,
    recheckPlan: vi.fn(),
  }),
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));
vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    notification: vi.fn(),
    selection: mockSelection,
  }),
}));
vi.mock("@/context/ToastContext", () => ({ useToast: () => mockToast }));

const ivy = { id: 1, name: "Ivy", allergies: [], note: null };

/** Server state: the switch value, the profile list, and an optional PUT failure. */
function server(opts: {
  switchOn: boolean;
  profiles?: unknown[];
  putError?: Error;
  /** Hold the PUT until this resolves, so a test can see the pending state. */
  putGate?: Promise<void>;
}) {
  mockApiRequest.mockImplementation(async (method: string, url: string) => {
    if (method === "PUT" && url === "/api/family-planning") {
      await opts.putGate;
      if (opts.putError) throw opts.putError;
      return { json: async () => ({ enabled: true }) };
    }
    if (url === "/api/user/dietary-profile") {
      return { json: async () => ({ familyPlanningEnabled: opts.switchOn }) };
    }
    return {
      json: async () => ({
        enabled: opts.switchOn,
        profiles: opts.profiles ?? [],
      }),
    };
  });
}

function setup() {
  const onLocked = vi.fn();
  const { wrapper } = createQueryWrapper();
  const hook = renderHook(() => useFamilySwitch({ onLocked }), { wrapper });
  return { ...hook, onLocked };
}

const putCalls = () => mockApiRequest.mock.calls.filter((c) => c[0] === "PUT");

beforeEach(() => {
  vi.clearAllMocks();
  mockState.flag = true;
  mockState.planUnknown = false;
});

describe("useFamilySwitch", () => {
  it("hides the row and the Family link while the plan is unknown", async () => {
    mockState.planUnknown = true;
    server({ switchOn: true });
    const { result } = setup();
    await waitFor(() => expect(mockApiRequest).toHaveBeenCalled());
    expect(result.current.visible).toBe(false);
    expect(result.current.showFamilyRow).toBe(false);
  });

  it("free plan: the switch reads off, and a press asks to upgrade instead of changing anything", async () => {
    mockState.flag = false;
    server({ switchOn: false });
    const { result, onLocked } = setup();
    expect(result.current.visible).toBe(true);
    expect(result.current.value).toBe(false);

    act(() => result.current.onToggle(true));

    expect(onLocked).toHaveBeenCalledTimes(1);
    expect(putCalls()).toHaveLength(0);
    expect(mockSelection).not.toHaveBeenCalled();
  });

  it("premium: turning on PUTs true with a selection tick, and the switch disables while it saves", async () => {
    let release!: () => void;
    const putGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server({ switchOn: false, profiles: [ivy], putGate });
    const { result } = setup();

    act(() => result.current.onToggle(true));

    expect(mockSelection).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.disabled).toBe(true));
    // The switch follows the pending value, not the (still off) server value.
    expect(result.current.value).toBe(true);
    // A second press while saving is ignored: one request, one tick.
    act(() => result.current.onToggle(false));
    expect(mockSelection).toHaveBeenCalledTimes(1);

    release();
    await waitFor(() => expect(result.current.disabled).toBe(false));
    expect(putCalls()).toEqual([
      ["PUT", "/api/family-planning", { enabled: true }],
    ]);
  });

  it("turning on with no profiles opens the new-profile screen", async () => {
    server({ switchOn: false, profiles: [] });
    const { result } = setup();
    act(() => result.current.onToggle(true));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("FamilyProfileEdit", {}),
    );
  });

  it("turning on with profiles already saved stays on the screen", async () => {
    server({ switchOn: false, profiles: [ivy] });
    const { result } = setup();
    act(() => result.current.onToggle(true));
    await waitFor(() => expect(result.current.disabled).toBe(false));
    expect(putCalls()).toHaveLength(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("turning off PUTs false and does not navigate", async () => {
    server({ switchOn: true, profiles: [] });
    const { result } = setup();
    await waitFor(() => expect(result.current.value).toBe(true));
    act(() => result.current.onToggle(false));
    await waitFor(() =>
      expect(mockApiRequest).toHaveBeenCalledWith(
        "PUT",
        "/api/family-planning",
        { enabled: false },
      ),
    );
    await waitFor(() => expect(result.current.disabled).toBe(false));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("a failed toggle reverts the switch and toasts plain words", async () => {
    server({
      switchOn: false,
      putError: new ApiError("500: internal detail", undefined, 500),
    });
    const { result } = setup();
    act(() => result.current.onToggle(true));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledTimes(1));
    expect(mockToast.error.mock.calls[0][0]).not.toMatch(/internal detail/);
    await waitFor(() => expect(result.current.value).toBe(false));
    expect(result.current.disabled).toBe(false);
  });

  it("a stale entitlement (server says premium required) reverts and shows the upgrade prompt", async () => {
    server({
      switchOn: false,
      putError: new ApiError("403: x", ErrorCode.PREMIUM_REQUIRED, 403),
    });
    const { result, onLocked } = setup();
    act(() => result.current.onToggle(true));
    await waitFor(() => expect(onLocked).toHaveBeenCalledTimes(1));
    expect(mockToast.error).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.value).toBe(false));
  });

  it("a lapsed user whose switch is still on sees it off, and still gets the Family link", async () => {
    mockState.flag = false;
    server({ switchOn: true, profiles: [ivy] });
    const { result } = setup();
    await waitFor(() => expect(result.current.showFamilyRow).toBe(true));
    expect(result.current.value).toBe(false);
  });

  it("no Family link while the switch is off", async () => {
    server({ switchOn: false });
    const { result } = setup();
    await waitFor(() => expect(mockApiRequest).toHaveBeenCalled());
    expect(result.current.showFamilyRow).toBe(false);
  });

  it("opening the Family link navigates to the list", async () => {
    server({ switchOn: true });
    const { result } = setup();
    act(() => result.current.onOpenProfiles());
    expect(mockNavigate).toHaveBeenCalledWith("FamilyProfiles");
  });
});
