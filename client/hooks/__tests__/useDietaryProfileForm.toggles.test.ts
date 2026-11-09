// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";
import { QUERY_KEYS } from "@/lib/query-keys";
import { useDietaryProfileForm } from "../useDietaryProfileForm";

const { mockImpact, mockSelection } = vi.hoisted(() => ({
  mockImpact: vi.fn(),
  mockSelection: vi.fn(),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ goBack: vi.fn() }),
}));
vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: mockImpact,
    notification: vi.fn(),
    selection: mockSelection,
  }),
}));
vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/lib/query-client", () => ({ apiRequest: vi.fn() }));

function renderForm() {
  const { queryClient, wrapper } = createQueryWrapper();
  queryClient.setQueryData(QUERY_KEYS.dietaryProfile, {});
  return renderHook(() => useDietaryProfileForm(), { wrapper });
}

beforeEach(() => {
  mockImpact.mockClear();
  mockSelection.mockClear();
});

// The tiles that call these tick `selection()` themselves (SelectableTile),
// so the hook stays silent — one buzz per pick.
describe("useDietaryProfileForm — toggles leave the haptic to the tile", () => {
  it.each([
    ["toggleHealthCondition", "diabetes"],
    ["toggleDislike", "mushrooms"],
    ["toggleCuisine", "italian"],
  ] as const)("%s does not buzz", (fn, id) => {
    const { result } = renderForm();
    act(() => result.current[fn](id));
    act(() => result.current[fn](id));
    expect(mockImpact).not.toHaveBeenCalled();
    expect(mockSelection).not.toHaveBeenCalled();
  });

  it("picking an allergen, its severity, then removing it does not buzz", () => {
    const { result } = renderForm();
    act(() => result.current.toggleAllergen("peanuts"));
    act(() => result.current.setSeverity("severe"));
    expect(result.current.allergies).toEqual([
      { name: "peanuts", severity: "severe" },
    ]);
    act(() => result.current.toggleAllergen("peanuts"));
    expect(result.current.allergies).toEqual([]);
    expect(mockImpact).not.toHaveBeenCalled();
    expect(mockSelection).not.toHaveBeenCalled();
  });
});

describe("useDietaryProfileForm — an allergen handed in from Coach", () => {
  function renderWith(profile: object, addAllergen: string) {
    const { queryClient, wrapper } = createQueryWrapper();
    queryClient.setQueryData(QUERY_KEYS.dietaryProfile, profile);
    return renderHook(() => useDietaryProfileForm({ addAllergen }), {
      wrapper,
    });
  }

  it("opens the severity choice for it, and saves nothing until one is picked", () => {
    const { result } = renderWith({ allergies: [] }, "shellfish");
    expect(result.current.selectedAllergen).toBe("shellfish");
    expect(result.current.allergies).toEqual([]);
    act(() => result.current.setSeverity("moderate"));
    expect(result.current.allergies).toEqual([
      { name: "shellfish", severity: "moderate" },
    ]);
  });

  it("leaves an allergen the profile already has alone", () => {
    const { result } = renderWith(
      { allergies: [{ name: "shellfish", severity: "severe" }] },
      "shellfish",
    );
    expect(result.current.selectedAllergen).toBeNull();
  });
});
