// @vitest-environment jsdom
import { renderHook, waitFor, act } from "@testing-library/react";
import {
  useFamilyContext,
  usePlanFamily,
  useFamilyProfilesList,
  useDeleteFamilyProfile,
  useSetFamilyPlanning,
} from "../useFamily";
import { QUERY_KEYS, familyProfilesKey } from "@/lib/query-keys";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest, mockState } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
  mockState: { flag: true, planUnknown: false },
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

const ivy = { id: 1, name: "Ivy", allergies: [], note: null };

function route(switchOn: boolean) {
  mockApiRequest.mockImplementation(async (_m: string, url: string) => ({
    json: async () =>
      url === "/api/user/dietary-profile"
        ? { familyPlanningEnabled: switchOn }
        : { enabled: switchOn, profiles: [ivy] },
  }));
}

describe("useFamilyContext", () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
    mockState.flag = true;
    mockState.planUnknown = false;
  });

  it("is active with the flag and the switch on, and lists profiles", async () => {
    route(true);
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useFamilyContext(), { wrapper });
    await waitFor(() => expect(result.current.profiles).toEqual([ivy]));
    expect(result.current.active).toBe(true);
  });

  it("is inactive with no profiles when the flag is off", async () => {
    mockState.flag = false;
    route(true);
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useFamilyContext(), { wrapper });
    await waitFor(() => expect(mockApiRequest).toHaveBeenCalled());
    expect(result.current).toMatchObject({ active: false, profiles: [] });
  });

  it("is inactive when the switch is off", async () => {
    route(false);
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useFamilyContext(), { wrapper });
    await waitFor(() => expect(mockApiRequest).toHaveBeenCalled());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current).toMatchObject({ active: false, profiles: [] });
  });

  it("is inactive while the plan is unknown", async () => {
    mockState.planUnknown = true;
    route(true);
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useFamilyContext(), { wrapper });
    await waitFor(() => expect(mockApiRequest).toHaveBeenCalled());
    expect(result.current).toMatchObject({ active: false, profiles: [] });
  });
});

describe("usePlanFamily", () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
    mockState.flag = true;
    mockState.planUnknown = false;
  });

  it("is the profiles and the user's own allergies when planning is on", async () => {
    const allergies = [{ name: "milk", severity: "mild" }];
    mockApiRequest.mockImplementation(async (_m: string, url: string) => ({
      json: async () =>
        url === "/api/user/dietary-profile"
          ? { familyPlanningEnabled: true, allergies }
          : { enabled: true, profiles: [ivy] },
    }));
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => usePlanFamily(), { wrapper });
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).toEqual({
      profiles: [ivy],
      userAllergies: allergies,
    });
  });

  // The pick-time allergen check lists it in callback deps; a fresh object
  // each render rebuilt the add sheets' list rows.
  it("is the same object across re-renders while nothing changed", async () => {
    mockApiRequest.mockImplementation(async (_m: string, url: string) => ({
      json: async () =>
        url === "/api/user/dietary-profile"
          ? { familyPlanningEnabled: true, allergies: [] }
          : { enabled: true, profiles: [ivy] },
    }));
    const { wrapper } = createQueryWrapper();
    const { result, rerender } = renderHook(() => usePlanFamily(), {
      wrapper,
    });
    await waitFor(() => expect(result.current).not.toBeNull());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("is null when planning is on but there are no profiles yet", async () => {
    mockApiRequest.mockImplementation(async (_m: string, url: string) => ({
      json: async () =>
        url === "/api/user/dietary-profile"
          ? { familyPlanningEnabled: true }
          : { enabled: true, profiles: [] },
    }));
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => usePlanFamily(), { wrapper });
    await waitFor(() => expect(mockApiRequest).toHaveBeenCalledTimes(2));
    expect(result.current).toBeNull();
  });

  it("is null when the switch is off", async () => {
    route(false);
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => usePlanFamily(), { wrapper });
    await waitFor(() => expect(mockApiRequest).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});

describe("mutations", () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
    mockState.flag = true;
    mockState.planUnknown = false;
  });

  it("deleting a profile invalidates the profile list and the meal plan queries", async () => {
    mockApiRequest.mockResolvedValue({ json: async () => ({}) });
    const { wrapper, queryClient } = createQueryWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useDeleteFamilyProfile(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(1);
    });
    expect(mockApiRequest).toHaveBeenCalledWith(
      "DELETE",
      "/api/family-profiles/1",
    );
    const calls = spy.mock.calls.map((c) => c[0]);
    expect(calls).toContainEqual({ queryKey: familyProfilesKey() });
    // Behaviour, not the predicate's shape: seed real queries and see which go stale.
    queryClient.setQueryData(["/api/meal-plan", "a", "b"], []);
    queryClient.setQueryData(["/api/meal-plan/recipes"], []);
    spy.mockRestore();
    await act(async () => {
      await result.current.mutateAsync(1);
    });
    expect(
      queryClient.getQueryState(["/api/meal-plan", "a", "b"])?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(["/api/meal-plan/recipes"])?.isInvalidated,
    ).toBe(false);
  });

  it("the switch PUTs and refreshes the dietary profile and the list", async () => {
    mockApiRequest.mockResolvedValue({ json: async () => ({ enabled: true }) });
    const { wrapper, queryClient } = createQueryWrapper();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSetFamilyPlanning(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(true);
    });
    expect(mockApiRequest).toHaveBeenCalledWith("PUT", "/api/family-planning", {
      enabled: true,
    });
    const calls = spy.mock.calls.map((c) => c[0]);
    expect(calls).toContainEqual({ queryKey: QUERY_KEYS.dietaryProfile });
    expect(calls).toContainEqual({ queryKey: familyProfilesKey() });
  });

  // Invalidating the list on switch-off refetched it once more through any
  // screen still mounted, after the user had just turned family planning off.
  it("switching off drops the profile list instead of refetching it", async () => {
    mockApiRequest.mockResolvedValue({
      json: async () => ({ enabled: false }),
    });
    const { wrapper, queryClient } = createQueryWrapper();
    queryClient.setQueryData(familyProfilesKey(), {
      enabled: true,
      profiles: [ivy],
    });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSetFamilyPlanning(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(false);
    });
    expect(queryClient.getQueryData(familyProfilesKey())).toBeUndefined();
    expect(invalidate.mock.calls.map((c) => c[0])).not.toContainEqual({
      queryKey: familyProfilesKey(),
    });
  });

  // The switch shows the pending value only while the mutation is pending. If
  // it settled before the profile was refetched, the switch would drop back to
  // its old position for a moment after the server said yes.
  it("the switch stays pending until the dietary profile has been refetched", async () => {
    mockApiRequest.mockResolvedValue({ json: async () => ({ enabled: true }) });
    const { wrapper, queryClient } = createQueryWrapper();
    let finishRefetch: () => void = () => {};
    vi.spyOn(queryClient, "invalidateQueries").mockImplementation((filters) =>
      filters &&
      "queryKey" in filters &&
      filters.queryKey === QUERY_KEYS.dietaryProfile
        ? new Promise<void>((resolve) => {
            finishRefetch = resolve;
          })
        : Promise.resolve(),
    );
    const { result } = renderHook(() => useSetFamilyPlanning(), { wrapper });
    act(() => {
      result.current.mutate(true);
    });
    await waitFor(() => expect(mockApiRequest).toHaveBeenCalled());
    // The PUT has answered; the refetch has not.
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.isPending).toBe(true);
    await act(async () => {
      finishRefetch();
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });
});

describe("useFamilyProfilesList (management screens)", () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
    mockState.flag = true;
    mockState.planUnknown = false;
  });

  it("loads the list even when the premium flag is off and the switch is off", async () => {
    mockState.flag = false;
    route(false);
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useFamilyProfilesList(), { wrapper });
    await waitFor(() => expect(result.current.profiles).toEqual([ivy]));
    expect(mockApiRequest).toHaveBeenCalledWith(
      "GET",
      "/api/family-profiles",
      undefined,
      expect.anything(),
    );
  });

  it("shares the query key with useFamilyContext, so one cache entry serves both", async () => {
    route(true);
    const { wrapper, queryClient } = createQueryWrapper();
    const { result } = renderHook(() => useFamilyProfilesList(), { wrapper });
    await waitFor(() => expect(result.current.profiles).toEqual([ivy]));
    expect(queryClient.getQueryData(familyProfilesKey())).toEqual({
      enabled: true,
      profiles: [ivy],
    });
  });

  it("reports a failed load", async () => {
    mockApiRequest.mockRejectedValue(new Error("boom"));
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useFamilyProfilesList(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.profiles).toEqual([]);
  });
});
