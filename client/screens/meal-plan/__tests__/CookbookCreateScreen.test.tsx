// @vitest-environment jsdom
//
// Net-new coverage for the cookbook cover experience. The two behaviours worth
// pinning are (a) the screen can always be left, and leaving REMOVES it — it
// is reachable from Home as the only route in the Plan stack, where goBack()
// bubbles to the tab navigator and leaves the form behind — and (b) a
// cover failure after the cookbook row is committed must not read as "creation
// failed".
import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { AccessibilityInfo } from "react-native";

import { renderComponent } from "../../../../test/utils/render-component";
import CookbookCreateScreen from "../CookbookCreateScreen";

const {
  mockNavigate,
  mockGoBack,
  mockCanGoBack,
  mockPopTo,
  mockGetState,
  mockSetOptions,
  mockSetParams,
  mockParentNavigate,
  mockRouteParams,
  mockCreate,
  mockUpdate,
  mockUploadCover,
  mockGenerateCover,
  mockCookbookDetail,
  mockPremiumFeature,
  mockLaunchImageLibrary,
  mockToastError,
  mockAnnounce,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockGoBack: vi.fn(),
  mockCanGoBack: vi.fn(),
  mockPopTo: vi.fn(),
  mockGetState: vi.fn(),
  mockSetOptions: vi.fn(),
  mockSetParams: vi.fn(),
  mockParentNavigate: vi.fn(),
  mockRouteParams: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockUploadCover: vi.fn(),
  mockGenerateCover: vi.fn(),
  mockCookbookDetail: vi.fn(),
  mockPremiumFeature: vi.fn(),
  mockLaunchImageLibrary: vi.fn(),
  mockToastError: vi.fn(),
  mockAnnounce: vi.fn(),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: mockCanGoBack,
    popTo: mockPopTo,
    getState: mockGetState,
    setOptions: mockSetOptions,
    setParams: mockSetParams,
    dispatch: vi.fn(),
    getParent: () => ({ navigate: mockParentNavigate }),
  }),
  useRoute: () => ({ params: mockRouteParams() }),
  usePreventRemove: vi.fn(),
}));

vi.mock("@react-navigation/bottom-tabs", () => ({
  useBottomTabBarHeight: () => 0,
}));

vi.mock("expo-image", () => ({
  Image: () => null,
}));

vi.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: (...args: unknown[]) =>
    mockLaunchImageLibrary(...args),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: mockToastError,
    info: vi.fn(),
  }),
}));

vi.mock("@/hooks/usePremiumFeatures", () => ({
  usePremiumFeature: (key: string) => mockPremiumFeature(key),
}));

vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: ({ visible }: { visible: boolean }) =>
    visible ? React.createElement("div", null, "UPGRADE_MODAL") : null,
}));

vi.mock("@/hooks/useCookbooks", () => ({
  useCookbookDetail: () => mockCookbookDetail(),
  useCreateCookbook: () => ({
    mutateAsync: mockCreate,
    isPending: false,
  }),
  useUpdateCookbook: () => ({
    mutateAsync: mockUpdate,
    isPending: false,
  }),
  useUploadCookbookCover: () => ({
    mutateAsync: mockUploadCover,
    isPending: false,
  }),
  useGenerateCookbookCover: () => ({
    mutateAsync: mockGenerateCover,
    isPending: false,
  }),
}));

const idleDetail = {
  data: undefined,
  isError: false,
  isLoading: false,
  refetch: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRouteParams.mockReturnValue(undefined);
  // Default: pushed onto an existing stack. The one-route case is opted into
  // per test. canGoBack() stays true throughout — it answers for PARENT
  // navigators too (the tab router can always go back to Home), which is
  // exactly why the screen must not branch on it.
  mockCanGoBack.mockReturnValue(true);
  mockGetState.mockReturnValue(stackState(2));
  mockCookbookDetail.mockReturnValue(idleDetail);
  mockPremiumFeature.mockReturnValue(true);
  mockCreate.mockResolvedValue({ id: 7, name: "Weeknight Dinners" });
  mockUploadCover.mockResolvedValue({ id: 7 });
  mockGenerateCover.mockResolvedValue({ id: 7 });
  mockLaunchImageLibrary.mockResolvedValue({ canceled: true, assets: [] });
  vi.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(
    mockAnnounce,
  );
});

/** A Plan-stack state with `n` routes (1-3), CookbookCreate on top. */
function stackState(n: number) {
  const beneath = [
    { key: "home-1", name: "MealPlanHome" },
    { key: "list-1", name: "CookbookList" },
  ].slice(0, n - 1);
  const routes = [...beneath, { key: "create-1", name: "CookbookCreate" }];
  return { index: routes.length - 1, routes };
}

/** Pull the headerLeft element the screen registered via setOptions. */
function renderHeaderLeft() {
  const call = mockSetOptions.mock.calls.at(-1)?.[0] as
    | { headerLeft?: () => React.ReactElement }
    | undefined;
  expect(call?.headerLeft).toBeTypeOf("function");
  return call!.headerLeft!();
}

function typeName(value: string) {
  const input = screen.getByLabelText("Name");
  fireEvent.change(input, { target: { value } });
}

describe("CookbookCreateScreen — leaving the screen", () => {
  it("registers an explicit close control and hides the native back button", () => {
    renderComponent(<CookbookCreateScreen />);

    const options = mockSetOptions.mock.calls.at(-1)?.[0] as {
      headerBackVisible?: boolean;
      headerLeft?: () => React.ReactElement;
    };
    expect(options.headerBackVisible).toBe(false);
    expect(options.headerLeft).toBeTypeOf("function");
  });

  // canGoBack() is true in every cell below: it bubbles to the tab router,
  // which can always go back to Home. Branching on it sent the one-route
  // case's goBack() to the TAB navigator — Home was shown but this route was
  // never removed, so the form reappeared on every return to Plan.

  it("from Home, as the only route: pops to MealPlanHome, then shows Home", () => {
    mockGetState.mockReturnValue(stackState(1));
    mockRouteParams.mockReturnValue({ fromHome: true });
    renderComponent(<CookbookCreateScreen />);
    renderComponent(renderHeaderLeft());

    fireEvent.click(screen.getByLabelText("Close without saving"));

    expect(mockPopTo).toHaveBeenCalledWith("MealPlanHome");
    expect(mockParentNavigate).toHaveBeenCalledWith("HomeTab");
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it("from Home, with a route beneath: pops to MealPlanHome, then shows Home", () => {
    // A goBack() here is intercepted by useFromHomeBackRedirect, which shows
    // Home but leaves the form mounted on top of the Plan stack.
    mockGetState.mockReturnValue(stackState(2));
    mockRouteParams.mockReturnValue({ fromHome: true });
    renderComponent(<CookbookCreateScreen />);
    renderComponent(renderHeaderLeft());

    fireEvent.click(screen.getByLabelText("Close without saving"));

    expect(mockPopTo).toHaveBeenCalledWith("MealPlanHome");
    expect(mockParentNavigate).toHaveBeenCalledWith("HomeTab");
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it("from Home, over a deeper Plan stack: still pops to MealPlanHome", () => {
    // Accepted trade-off: popTo also drops a CookbookList the user had open
    // in Plan. A plain pop() would be a back action, which
    // useFromHomeBackRedirect intercepts — leaving the form mounted again.
    mockGetState.mockReturnValue(stackState(3));
    mockRouteParams.mockReturnValue({ fromHome: true });
    renderComponent(<CookbookCreateScreen />);
    renderComponent(renderHeaderLeft());

    fireEvent.click(screen.getByLabelText("Close without saving"));

    expect(mockPopTo).toHaveBeenCalledWith("MealPlanHome");
    expect(mockParentNavigate).toHaveBeenCalledWith("HomeTab");
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it("within Plan, with a route beneath: goes back", () => {
    mockGetState.mockReturnValue(stackState(3));
    renderComponent(<CookbookCreateScreen />);
    renderComponent(renderHeaderLeft());

    fireEvent.click(screen.getByLabelText("Close without saving"));

    expect(mockGoBack).toHaveBeenCalled();
    expect(mockPopTo).not.toHaveBeenCalled();
    expect(mockParentNavigate).not.toHaveBeenCalled();
  });

  it("within Plan, as the only route: pops to MealPlanHome and stays in Plan", () => {
    mockGetState.mockReturnValue(stackState(1));
    renderComponent(<CookbookCreateScreen />);
    renderComponent(renderHeaderLeft());

    fireEvent.click(screen.getByLabelText("Close without saving"));

    expect(mockPopTo).toHaveBeenCalledWith("MealPlanHome");
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(mockParentNavigate).not.toHaveBeenCalled();
  });
});

describe("CookbookCreateScreen — cover generation gating", () => {
  it("opens the upgrade modal for a free user and never arms generation", () => {
    mockPremiumFeature.mockReturnValue(false);
    renderComponent(<CookbookCreateScreen />);

    fireEvent.click(screen.getByLabelText("Generate a cover, premium feature"));

    expect(screen.getByText("UPGRADE_MODAL")).toBeTruthy();
    expect(mockGenerateCover).not.toHaveBeenCalled();
  });

  it("labels the action without the premium suffix for an entitled user", () => {
    renderComponent(<CookbookCreateScreen />);

    expect(screen.getByLabelText("Generate a cover")).toBeTruthy();
  });

  it("generates immediately in edit mode", async () => {
    mockRouteParams.mockReturnValue({ cookbookId: 3 });
    mockCookbookDetail.mockReturnValue({
      ...idleDetail,
      data: {
        id: 3,
        name: "Sunday Bakes",
        description: null,
        coverImageUrl: null,
      },
    });
    renderComponent(<CookbookCreateScreen />);

    fireEvent.click(screen.getByLabelText("Generate a cover"));

    await waitFor(() => expect(mockGenerateCover).toHaveBeenCalledWith(3));
  });
});

describe("CookbookCreateScreen — create then attach", () => {
  it("creates the cookbook, then generates the armed cover", async () => {
    renderComponent(<CookbookCreateScreen />);
    typeName("Weeknight Dinners");

    fireEvent.click(screen.getByLabelText("Generate a cover"));
    fireEvent.click(screen.getByLabelText("Create cookbook"));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        name: "Weeknight Dinners",
        description: undefined,
      }),
    );
    // Generation targets the id the create call returned.
    await waitFor(() => expect(mockGenerateCover).toHaveBeenCalledWith(7));
    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
  });

  it("uploads a picked photo against the newly created id", async () => {
    mockLaunchImageLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///picked.jpg" }],
    });
    renderComponent(<CookbookCreateScreen />);
    typeName("Weeknight Dinners");

    fireEvent.click(screen.getByLabelText("Add cover photo"));
    await waitFor(() => expect(mockLaunchImageLibrary).toHaveBeenCalled());

    fireEvent.click(screen.getByLabelText("Create cookbook"));

    await waitFor(() =>
      expect(mockUploadCover).toHaveBeenCalledWith({
        cookbookId: 7,
        uri: "file:///picked.jpg",
      }),
    );
    expect(mockGenerateCover).not.toHaveBeenCalled();
  });

  it("still completes when the cover step fails after the cookbook is saved", async () => {
    mockGenerateCover.mockRejectedValue(new Error("provider down"));
    renderComponent(<CookbookCreateScreen />);
    typeName("Weeknight Dinners");

    fireEvent.click(screen.getByLabelText("Generate a cover"));
    fireEvent.click(screen.getByLabelText("Create cookbook"));

    // The row is committed — the failure is reported as a cover problem, and
    // the flow completes rather than stranding the user on the form.
    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        expect.stringContaining("Cookbook created, but the cover couldn't"),
      ),
    );
    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
    // Toast is itself an announcer (iOS imperative + Android live region), so
    // the screen must NOT announce here too: iOS announcements don't queue,
    // and TalkBack would speak it twice.
    expect(mockAnnounce).not.toHaveBeenCalled();
  });

  it("announces creation exactly once on the happy path", async () => {
    // Two announceForAccessibility calls in the same commit collide on iOS.
    renderComponent(<CookbookCreateScreen />);
    typeName("Weeknight Dinners");

    fireEvent.click(screen.getByLabelText("Create cookbook"));

    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
    expect(mockAnnounce).toHaveBeenCalledTimes(1);
    expect(mockAnnounce).toHaveBeenCalledWith("Cookbook created");
  });
});

describe("CookbookCreateScreen — edit-mode load guard", () => {
  /** Edit mode with the detail fetch resolved to a real cookbook. */
  function mockLoadedCookbook(overrides: Record<string, unknown> = {}) {
    mockRouteParams.mockReturnValue({ cookbookId: 3 });
    mockCookbookDetail.mockReturnValue({
      ...idleDetail,
      data: {
        id: 3,
        name: "Sunday Bakes",
        description: "Weekend baking",
        coverImageUrl: null,
        ...overrides,
      },
    });
  }

  // POSITIVE CONTROL for the two tests below. Without it, their
  // `not.toHaveBeenCalled()` assertions can't distinguish "the guard blocked
  // the click" from "the click never reached the handler at all" — a typo'd
  // label or a broken isEditMode would leave them just as green.
  it("saves when the cookbook loaded normally", async () => {
    mockLoadedCookbook();
    renderComponent(<CookbookCreateScreen />);

    fireEvent.click(screen.getByLabelText("Save changes"));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        id: 3,
        name: "Sunday Bakes",
        description: "Weekend baking",
      }),
    );
    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
    expect(mockAnnounce).toHaveBeenCalledWith("Cookbook updated");
  });

  it("leaves the cover actions usable when the cookbook loaded", () => {
    // Positive control for the destructive-cover guard below.
    mockLoadedCookbook({ coverImageUrl: "https://cdn.test/c.png" });
    renderComponent(<CookbookCreateScreen />);

    fireEvent.click(screen.getByLabelText("Replace cover photo"));

    expect(mockLaunchImageLibrary).toHaveBeenCalled();
  });

  it("blocks the cover actions while the cookbook fetch has failed", () => {
    // The destructive case: with the fetch failed, storedCoverUrl is null, so
    // the button would read "Add cover photo" for a cookbook that HAS one —
    // and the server would find the real cover and delete it.
    mockRouteParams.mockReturnValue({ cookbookId: 3 });
    mockCookbookDetail.mockReturnValue({ ...idleDetail, isError: true });
    renderComponent(<CookbookCreateScreen />);

    fireEvent.click(screen.getByLabelText("Add cover photo"));
    fireEvent.click(screen.getByLabelText("Generate a cover"));

    expect(mockLaunchImageLibrary).not.toHaveBeenCalled();
    expect(mockGenerateCover).not.toHaveBeenCalled();
  });

  it("blocks saving while the cookbook fetch has failed", () => {
    // Submitting an empty form here would blank a real cookbook's fields.
    mockRouteParams.mockReturnValue({ cookbookId: 3 });
    mockCookbookDetail.mockReturnValue({
      ...idleDetail,
      isError: true,
    });
    renderComponent(<CookbookCreateScreen />);

    typeName("Anything");
    fireEvent.click(screen.getByLabelText("Save changes"));

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Couldn't load this cookbook to edit. Saving is disabled until it loads.",
      ),
    ).toBeTruthy();
  });
});
