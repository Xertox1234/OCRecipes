// @vitest-environment jsdom
//
// The step-by-step New Cookbook flow: the step rules the screen enforces,
// the create-then-attach run on Review, and the create-mode behaviour that
// moved here from CookbookCreateScreen (empty name, upgrade gating, the one
// announcer per outcome, the success settle).
import React from "react";
import { act, screen, fireEvent, waitFor } from "@testing-library/react";
import { AccessibilityInfo } from "react-native";
import * as Haptics from "expo-haptics";

import { renderComponent } from "../../../../test/utils/render-component";
import { reactProps } from "../../../../test/utils/react-props";
import CookbookCreateWizard from "../CookbookCreateWizard";
import { stepBlocker } from "@/components/cookbook/cookbook-wizard-utils";
import { ApiError } from "@/lib/api-error";

const { stepBlocker: actualStepBlocker } = await vi.importActual<
  typeof import("@/components/cookbook/cookbook-wizard-utils")
>("@/components/cookbook/cookbook-wizard-utils");

const {
  mockGoBack,
  mockCanGoBack,
  mockPopTo,
  mockGetState,
  mockSetOptions,
  mockIsFocused,
  mockAddListener,
  mockRouteParams,
  mockCreate,
  mockUploadCover,
  mockGenerateCandidates,
  mockAttachCandidate,
  mockAddRecipe,
  mockPremiumFeature,
  mockLaunchImageLibrary,
  mockToastError,
  mockToastSuccess,
  mockAnnounce,
  sources,
} = vi.hoisted(() => ({
  mockGoBack: vi.fn(),
  mockCanGoBack: vi.fn(),
  mockPopTo: vi.fn(),
  mockGetState: vi.fn(),
  mockSetOptions: vi.fn(),
  mockIsFocused: vi.fn(),
  mockAddListener: vi.fn(),
  mockRouteParams: vi.fn(),
  mockCreate: vi.fn(),
  mockUploadCover: vi.fn(),
  mockGenerateCandidates: vi.fn(),
  mockAttachCandidate: vi.fn(),
  mockAddRecipe: vi.fn(),
  mockPremiumFeature: vi.fn(),
  mockLaunchImageLibrary: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockAnnounce: vi.fn(),
  sources: {
    favourites: [] as unknown[],
    pending: false,
    // Forces the Recipes step to report availability as unknown again — a
    // state the real sources can't return to once settled.
    reportUnknown: false,
    // Fails the "my recipes" source, leaving favourites loaded.
    unifiedError: false,
  },
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    navigate: vi.fn(),
    goBack: mockGoBack,
    canGoBack: mockCanGoBack,
    popTo: mockPopTo,
    getState: mockGetState,
    setOptions: mockSetOptions,
    isFocused: mockIsFocused,
    addListener: mockAddListener,
    setParams: vi.fn(),
    dispatch: vi.fn(),
    getParent: () => ({ navigate: vi.fn() }),
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

// react-native-keyboard-controller ships untransformed native source — passthrough.
vi.mock("react-native-keyboard-controller", () => ({
  KeyboardAwareScrollView: ({
    children,
    ...props
  }: {
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => React.createElement("div", props, children),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({
    success: mockToastSuccess,
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
  useCreateCookbook: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUploadCookbookCover: () => ({
    mutateAsync: mockUploadCover,
    isPending: false,
  }),
  useGenerateCoverCandidates: () => ({
    mutateAsync: mockGenerateCandidates,
    isPending: false,
  }),
  useAttachCoverCandidate: () => ({
    mutateAsync: mockAttachCandidate,
    isPending: false,
  }),
  useAddRecipeToCookbook: () => ({
    mutateAsync: mockAddRecipe,
    isPending: false,
  }),
}));

vi.mock("@/hooks/useFavouriteRecipes", () => ({
  useFavouriteRecipes: () => ({
    data: sources.pending ? undefined : sources.favourites,
    isPending: sources.pending,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/useMealPlanRecipes", () => ({
  useUnifiedRecipes: () => ({
    data:
      sources.pending || sources.unifiedError
        ? undefined
        : { community: [], personal: [], frequent: [] },
    isPending: sources.pending,
    isError: sources.unifiedError,
    refetch: vi.fn(),
  }),
}));

// Wraps the real step; can report availability as unknown (see sources).
vi.mock("@/components/cookbook/WizardRecipesStep", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/cookbook/WizardRecipesStep")
    >();
  function WizardRecipesStep(
    props: React.ComponentProps<typeof actual.WizardRecipesStep>,
  ) {
    const { onAvailability } = props;
    React.useEffect(() => {
      if (sources.reportUnknown) {
        (onAvailability as (v: boolean | null) => void)(null);
      }
    }, [onAvailability]);
    return React.createElement(actual.WizardRecipesStep, props);
  }
  return { ...actual, WizardRecipesStep };
});

// Pass-through by default; the Create backstop test overrides it to get a
// blank name past the step rules.
vi.mock(
  "@/components/cookbook/cookbook-wizard-utils",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/components/cookbook/cookbook-wizard-utils")
      >();
    return { ...actual, stepBlocker: vi.fn(actual.stepBlocker) };
  },
);

const chicken = {
  recipeId: 11,
  recipeType: "community" as const,
  title: "Garlic Lemon Chicken",
  imageUrl: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRouteParams.mockReturnValue(undefined);
  mockCanGoBack.mockReturnValue(true);
  mockIsFocused.mockReturnValue(true);
  mockAddListener.mockImplementation(() => vi.fn());
  // Pushed onto MealPlanHome, so dismiss() is a plain goBack().
  mockGetState.mockReturnValue({
    index: 1,
    routes: [
      { key: "home-1", name: "MealPlanHome" },
      { key: "create-1", name: "CookbookCreate" },
    ],
  });
  mockPremiumFeature.mockReturnValue(true);
  mockCreate.mockResolvedValue({ id: 7, name: "Weeknight Dinners" });
  mockUploadCover.mockResolvedValue({ id: 7 });
  mockGenerateCandidates.mockResolvedValue({
    candidates: [
      { id: "cand-a", imageUrl: "https://cdn.test/a.jpg" },
      { id: "cand-b", imageUrl: "https://cdn.test/b.jpg" },
    ],
    expiresAt: "2026-10-31T18:00:00.000Z",
    promptIgnored: false,
  });
  mockAttachCandidate.mockResolvedValue({ id: 7 });
  mockAddRecipe.mockResolvedValue({});
  mockLaunchImageLibrary.mockResolvedValue({ canceled: true, assets: [] });
  sources.favourites = [chicken];
  sources.pending = false;
  sources.reportUnknown = false;
  sources.unifiedError = false;
  vi.mocked(stepBlocker).mockImplementation(actualStepBlocker);
  vi.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(
    mockAnnounce,
  );
  // jsdom has no Element.scrollTo; the screen scrolls to the top on each step.
  HTMLElement.prototype.scrollTo = vi.fn();
});

function typeName(value: string) {
  fireEvent.change(screen.getByLabelText("Cookbook name"), {
    target: { value },
  });
}

function pressContinue() {
  fireEvent.click(screen.getByRole("button", { name: /^Continue/ }));
}

/** On the Cover step: open the studio, generate a set, pick the second. */
async function generateAndPick() {
  fireEvent.click(screen.getByLabelText("Generate with AI"));
  fireEvent.click(screen.getByRole("button", { name: "Generate 4 covers" }));
  fireEvent.click(
    await screen.findByRole("radio", { name: "Cover option 2 of 2" }),
  );
}

/** Name → Cover → Recipes (picking the chicken) → Review. */
function walkToReview({ pick = true } = {}) {
  typeName("Weeknight Dinners");
  pressContinue();
  pressContinue();
  if (pick) fireEvent.click(screen.getByLabelText("Garlic Lemon Chicken"));
  pressContinue();
}

describe("CookbookCreateWizard — basics", () => {
  it("Continue with an empty name flags and focuses it, buzzes, and stays on Basics", () => {
    renderComponent(<CookbookCreateWizard />);
    const button = screen.getByRole("button", { name: "Continue" });
    expect(button.getAttribute("aria-disabled")).not.toBe("true");

    fireEvent.click(button);

    const name = screen.getByLabelText("Cookbook name");
    expect(screen.getByText("Enter a name for your cookbook.")).toBeTruthy();
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(name);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
    expect(screen.getByText("Name your cookbook")).toBeTruthy();
    expect(screen.queryByText("Design your cover")).toBeNull();
  });

  it("typing a name clears the message", () => {
    renderComponent(<CookbookCreateWizard />);
    pressContinue();
    typeName("Weeknight Dinners");
    expect(screen.queryByText("Enter a name for your cookbook.")).toBeNull();
  });

  it("Next on the name focuses the description", () => {
    renderComponent(<CookbookCreateWizard />);
    const name = screen.getByLabelText("Cookbook name");
    expect(reactProps(name).returnKeyType).toBe("next");
    act(() => {
      (reactProps(name).onSubmitEditing as () => void)();
    });
    expect(document.activeElement).toBe(
      screen.getByLabelText("Description (optional)"),
    );
  });

  it("hides Back on the first step", () => {
    renderComponent(<CookbookCreateWizard />);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });
});

describe("CookbookCreateWizard — moving through the steps", () => {
  it("walks Basics → Cover → Recipes → Review, which counts the picked recipe", () => {
    renderComponent(<CookbookCreateWizard />);
    typeName("Weeknight Dinners");

    pressContinue();
    expect(screen.getByText("Design your cover")).toBeTruthy();

    pressContinue();
    expect(screen.getByText("Choose your recipes")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Garlic Lemon Chicken"));
    fireEvent.click(
      screen.getByRole("button", { name: "Continue · 1 recipe" }),
    );

    expect(screen.getByText("Review & create")).toBeTruthy();
    expect(screen.getByText("1 recipe")).toBeTruthy();
  });

  it("Back returns to the previous step", () => {
    renderComponent(<CookbookCreateWizard />);
    typeName("Weeknight Dinners");
    pressContinue();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByText("Name your cookbook")).toBeTruthy();
  });

  it("won't leave Recipes with nothing picked when there are recipes to pick", () => {
    renderComponent(<CookbookCreateWizard />);
    typeName("Weeknight Dinners");
    pressContinue();
    pressContinue();
    vi.mocked(Haptics.notificationAsync).mockClear();

    pressContinue();

    expect(screen.getByText("Pick at least one recipe.")).toBeTruthy();
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
    expect(screen.getByText("Choose your recipes")).toBeTruthy();

    // Picking one clears the message.
    fireEvent.click(screen.getByLabelText("Garlic Lemon Chicken"));
    expect(screen.queryByText("Pick at least one recipe.")).toBeNull();
  });

  it("offers to skip Recipes when there is nothing to pick", () => {
    sources.favourites = [];
    renderComponent(<CookbookCreateWizard />);
    typeName("Weeknight Dinners");
    pressContinue();
    pressContinue();

    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));

    expect(screen.getByText("Review & create")).toBeTruthy();
  });

  it("counts the picked recipes, not 'Skip for now', when one source failed", () => {
    sources.unifiedError = true;
    renderComponent(<CookbookCreateWizard />);
    typeName("Weeknight Dinners");
    pressContinue();
    pressContinue();

    fireEvent.click(screen.getByLabelText("Garlic Lemon Chicken"));

    expect(
      screen.getByRole("button", { name: "Continue · 1 recipe" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Skip for now" })).toBeNull();
  });

  it("Edit Name on Review returns to Basics with the name kept", () => {
    renderComponent(<CookbookCreateWizard />);
    walkToReview();

    fireEvent.click(screen.getByLabelText("Edit Name"));

    expect(screen.getByText("Name your cookbook")).toBeTruthy();
    expect(
      (screen.getByLabelText("Cookbook name") as HTMLInputElement).value,
    ).toBe("Weeknight Dinners");
  });

  it("scrolls the body back to the top on each step change", () => {
    renderComponent(<CookbookCreateWizard />);
    const scrollTo = vi.mocked(HTMLElement.prototype.scrollTo);
    scrollTo.mockClear();
    typeName("Weeknight Dinners");

    pressContinue();

    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
  });
});

describe("CookbookCreateWizard — cover", () => {
  it("opens the upgrade modal for a free user and never arms generation", async () => {
    mockPremiumFeature.mockReturnValue(false);
    renderComponent(<CookbookCreateWizard />);
    typeName("Weeknight Dinners");
    pressContinue();

    fireEvent.click(screen.getByLabelText("Generate with AI, premium feature"));

    expect(screen.getByText("UPGRADE_MODAL")).toBeTruthy();
    pressContinue();
    fireEvent.click(screen.getByLabelText("Garlic Lemon Chicken"));
    pressContinue();
    fireEvent.click(screen.getByRole("button", { name: "Create Cookbook" }));
    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
    expect(mockGenerateCandidates).not.toHaveBeenCalled();
    expect(mockAttachCandidate).not.toHaveBeenCalled();
  });

  it("uploads a picked photo against the newly created id", async () => {
    mockLaunchImageLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///picked.jpg" }],
    });
    renderComponent(<CookbookCreateWizard />);
    typeName("Weeknight Dinners");
    pressContinue();

    fireEvent.click(screen.getByLabelText("Upload a photo"));
    await waitFor(() =>
      expect(
        screen
          .getByRole("radio", { name: "Upload a photo" })
          .getAttribute("aria-selected"),
      ).toBe("true"),
    );
    expect(mockLaunchImageLibrary).toHaveBeenCalledWith({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [3, 4],
      quality: 0.9,
    });
    pressContinue();
    fireEvent.click(screen.getByLabelText("Garlic Lemon Chicken"));
    pressContinue();
    fireEvent.click(screen.getByRole("button", { name: "Create Cookbook" }));

    await waitFor(() =>
      expect(mockUploadCover).toHaveBeenCalledWith({
        cookbookId: 7,
        uri: "file:///picked.jpg",
      }),
    );
    expect(mockAttachCandidate).not.toHaveBeenCalled();
  });

  it("generates a set from the name, description, request and style", async () => {
    renderComponent(<CookbookCreateWizard />);
    typeName("Weeknight Dinners");
    pressContinue();
    fireEvent.click(screen.getByLabelText("Generate with AI"));
    fireEvent.change(screen.getByLabelText("Describe your cover"), {
      target: { value: "  pasta on a board  " },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Golden hour style" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate 4 covers" }));

    await waitFor(() =>
      expect(mockGenerateCandidates).toHaveBeenCalledWith({
        name: "Weeknight Dinners",
        description: undefined,
        coverPrompt: "pasta on a board",
        style: "golden-hour",
      }),
    );
    expect(
      await screen.findByRole("radio", { name: "Cover option 1 of 2" }),
    ).toBeTruthy();
    expect(mockToastSuccess).toHaveBeenCalledWith("2 covers ready");
    expect(
      screen.getByRole("button", { name: "Generate 4 more" }),
    ).toBeTruthy();
  });

  it("shows user-safe copy when a set can't be made", async () => {
    mockGenerateCandidates.mockRejectedValue(
      new ApiError("429: raw server text", "DAILY_LIMIT_REACHED", 429),
    );
    renderComponent(<CookbookCreateWizard />);
    typeName("Weeknight Dinners");
    pressContinue();
    fireEvent.click(screen.getByLabelText("Generate with AI"));
    fireEvent.click(screen.getByRole("button", { name: "Generate 4 covers" }));

    expect(
      await screen.findByText(
        "You've made a lot of covers today. Try again tomorrow.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/raw server text/)).toBeNull();
  });

  it("toasts when the photo library can't be opened", async () => {
    mockLaunchImageLibrary.mockRejectedValue(new Error("no permission"));
    renderComponent(<CookbookCreateWizard />);
    typeName("Weeknight Dinners");
    pressContinue();

    fireEvent.click(screen.getByLabelText("Upload a photo"));

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        "Couldn't open your photo library.",
      ),
    );
  });
});

describe("CookbookCreateWizard — create", () => {
  it("creates the cookbook, adds the picked recipe, toasts once and closes", async () => {
    renderComponent(<CookbookCreateWizard />);
    walkToReview();
    // Each step change announces itself; only Create's outcome counts here.
    mockAnnounce.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Create Cookbook" }));

    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith({
      name: "Weeknight Dinners",
      description: undefined,
    });
    expect(mockAddRecipe).toHaveBeenCalledWith({
      cookbookId: 7,
      recipeId: 11,
      recipeType: "community",
    });
    // The toast is the one announcer; its own haptic is off because the
    // screen already fired one.
    expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).toHaveBeenCalledWith("Cookbook created", {
      haptic: false,
    });
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Success,
    );
    expect(mockAnnounce).not.toHaveBeenCalled();
  });

  it("lets the cover's success pop land before closing", async () => {
    renderComponent(<CookbookCreateWizard />);
    walkToReview();

    fireEvent.click(screen.getByRole("button", { name: "Create Cookbook" }));

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled());
    expect(mockGoBack).not.toHaveBeenCalled();
    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
  });

  it("creates only once when Create is pressed twice", async () => {
    renderComponent(<CookbookCreateWizard />);
    walkToReview();
    // Both presses land in ONE act, before React re-renders the button as
    // loading — only the ref guard can drop the second.
    const press = reactProps(
      screen.getByRole("button", { name: "Create Cookbook" }),
    ).onClick as () => void;

    act(() => {
      press();
      press();
    });

    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("attaches the picked cover to the new id", async () => {
    renderComponent(<CookbookCreateWizard />);
    typeName("Weeknight Dinners");
    pressContinue();
    await generateAndPick();
    pressContinue();
    fireEvent.click(screen.getByLabelText("Garlic Lemon Chicken"));
    pressContinue();

    fireEvent.click(screen.getByRole("button", { name: "Create Cookbook" }));

    await waitFor(() =>
      expect(mockAttachCandidate).toHaveBeenCalledWith({
        cookbookId: 7,
        candidateId: "cand-b",
      }),
    );
    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
  });

  it("creates with the plain cover when the studio is open but nothing is picked", async () => {
    renderComponent(<CookbookCreateWizard />);
    typeName("Weeknight Dinners");
    pressContinue();
    fireEvent.click(screen.getByLabelText("Generate with AI"));
    pressContinue();
    fireEvent.click(screen.getByLabelText("Garlic Lemon Chicken"));
    pressContinue();

    fireEvent.click(screen.getByRole("button", { name: "Create Cookbook" }));

    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
    expect(mockAttachCandidate).not.toHaveBeenCalled();
  });

  it("says the cover is being added while that step runs", async () => {
    let finishGenerate: (v: unknown) => void = () => {};
    mockAttachCandidate.mockImplementation(
      () => new Promise((resolve) => (finishGenerate = resolve)),
    );
    renderComponent(<CookbookCreateWizard />);
    typeName("Weeknight Dinners");
    pressContinue();
    await generateAndPick();
    pressContinue();
    fireEvent.click(screen.getByLabelText("Garlic Lemon Chicken"));
    pressContinue();

    fireEvent.click(screen.getByRole("button", { name: "Create Cookbook" }));

    expect(await screen.findByText("Adding your cover…")).toBeTruthy();
    expect(screen.queryByText("Creating…")).toBeNull();
    await act(async () => finishGenerate({ id: 7 }));
    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
  });

  it("still completes, as a partial success, when a recipe can't be added", async () => {
    mockAddRecipe.mockRejectedValue(new Error("server down"));
    renderComponent(<CookbookCreateWizard />);
    walkToReview();
    mockAnnounce.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Create Cookbook" }));

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        "Cookbook created, but 1 recipe couldn't be added.",
        { haptic: false },
      ),
    );
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Warning,
    );
    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(mockAnnounce).not.toHaveBeenCalled();
  });

  it("still completes when the cover step fails after the cookbook is saved", async () => {
    mockAttachCandidate.mockRejectedValue(new Error("410: expired"));
    renderComponent(<CookbookCreateWizard />);
    typeName("Weeknight Dinners");
    pressContinue();
    await generateAndPick();
    pressContinue();
    fireEvent.click(screen.getByLabelText("Garlic Lemon Chicken"));
    pressContinue();

    fireEvent.click(screen.getByRole("button", { name: "Create Cookbook" }));

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        expect.stringContaining("Cookbook created, but the cover couldn't"),
        { haptic: false },
      ),
    );
    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
  });

  it("keeps the wizard open with an error when create fails, and lets you retry", async () => {
    mockCreate.mockRejectedValueOnce(new Error("500: boom"));
    renderComponent(<CookbookCreateWizard />);
    walkToReview();

    fireEvent.click(screen.getByRole("button", { name: "Create Cookbook" }));

    expect(
      await screen.findByText(
        "Couldn't create this cookbook. Please try again.",
      ),
    ).toBeTruthy();
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(mockAddRecipe).not.toHaveBeenCalled();
    expect(screen.getByText("Review & create")).toBeTruthy();

    // The guard is released: a second press runs again.
    fireEvent.click(screen.getByRole("button", { name: "Create Cookbook" }));
    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});

/** The header close control as last registered, rendered on its own. */
function renderHeaderClose() {
  const options = mockSetOptions.mock.calls.at(-1)?.[0] as {
    headerLeft: () => React.ReactElement;
  };
  renderComponent(options.headerLeft());
  return screen.getByLabelText("Close without saving");
}

describe("CookbookCreateWizard — closing mid-save", () => {
  it("ignores the header close while Create is pending", async () => {
    let finishCreate: (v: unknown) => void = () => {};
    mockCreate.mockImplementation(
      () => new Promise((resolve) => (finishCreate = resolve)),
    );
    renderComponent(<CookbookCreateWizard />);
    walkToReview();
    fireEvent.click(screen.getByRole("button", { name: "Create Cookbook" }));
    await screen.findByText("Creating…");

    const close = renderHeaderClose();
    expect((close as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(close);

    expect(mockGoBack).not.toHaveBeenCalled();
    expect(mockPopTo).not.toHaveBeenCalled();
    await act(async () => finishCreate({ id: 7, name: "Weeknight Dinners" }));
    await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  });

  it("doesn't close after the settle if the screen already lost focus", async () => {
    renderComponent(<CookbookCreateWizard />);
    walkToReview();

    fireEvent.click(screen.getByRole("button", { name: "Create Cookbook" }));
    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled());
    mockIsFocused.mockReturnValue(false);

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(mockPopTo).not.toHaveBeenCalled();

    // Coming back must not find a saved, locked wizard with no way out:
    // the skipped close runs on return.
    const onFocus = mockAddListener.mock.calls
      .filter(([event]) => event === "focus")
      .at(-1)?.[1] as () => void;
    mockIsFocused.mockReturnValue(true);
    act(() => onFocus());
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});

describe("CookbookCreateWizard — step announcements", () => {
  it("announces nothing on mount", () => {
    renderComponent(<CookbookCreateWizard />);
    expect(mockAnnounce).not.toHaveBeenCalled();
  });

  it("announces each step change once, with its number and name", () => {
    renderComponent(<CookbookCreateWizard />);
    typeName("Weeknight Dinners");

    pressContinue();
    expect(mockAnnounce).toHaveBeenCalledTimes(1);
    expect(mockAnnounce).toHaveBeenLastCalledWith("Step 2 of 4, Cover");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(mockAnnounce).toHaveBeenCalledTimes(2);
    expect(mockAnnounce).toHaveBeenLastCalledWith("Step 1 of 4, Basics");
  });
});

describe("CookbookCreateWizard — recipes still loading", () => {
  it("reads Continue and stays put until it knows whether there are recipes", () => {
    sources.pending = true;
    renderComponent(<CookbookCreateWizard />);
    typeName("Weeknight Dinners");
    pressContinue();
    pressContinue();
    vi.mocked(Haptics.notificationAsync).mockClear();

    expect(screen.queryByRole("button", { name: "Skip for now" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText("Choose your recipes")).toBeTruthy();
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
    expect(screen.queryByText("Pick at least one recipe.")).toBeNull();
  });
});

describe("CookbookCreateWizard — forward jumps keep the step rules", () => {
  it("won't jump ahead from Basics with the name cleared, and never creates", () => {
    renderComponent(<CookbookCreateWizard />);
    walkToReview();
    fireEvent.click(screen.getByLabelText("Edit Name"));
    typeName("");
    vi.mocked(Haptics.notificationAsync).mockClear();

    fireEvent.click(screen.getByLabelText("Go to Review"));

    expect(screen.getByText("Name your cookbook")).toBeTruthy();
    expect(screen.getByText("Enter a name for your cookbook.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Cookbook name"));
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
    expect(
      screen.queryByRole("button", { name: "Create Cookbook" }),
    ).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("won't jump past Recipes with every pick cleared", () => {
    renderComponent(<CookbookCreateWizard />);
    walkToReview();
    fireEvent.click(screen.getByLabelText("Edit Recipes"));
    fireEvent.click(screen.getByLabelText("Garlic Lemon Chicken"));
    vi.mocked(Haptics.notificationAsync).mockClear();

    fireEvent.click(screen.getByLabelText("Go to Review"));

    expect(screen.getByText("Choose your recipes")).toBeTruthy();
    expect(screen.getByText("Pick at least one recipe.")).toBeTruthy();
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
  });

  it("still allows jumping back", () => {
    renderComponent(<CookbookCreateWizard />);
    walkToReview();

    fireEvent.click(screen.getByLabelText("Go back to Cover"));

    expect(screen.getByText("Design your cover")).toBeTruthy();
  });

  it("Create sends a blank name back to Basics instead of creating", () => {
    renderComponent(<CookbookCreateWizard />);
    walkToReview();
    fireEvent.click(screen.getByLabelText("Edit Name"));
    typeName("");
    // Simulate a path past the step rules, so only Create's own check stands.
    vi.mocked(stepBlocker).mockReturnValue(null);
    fireEvent.click(screen.getByLabelText("Go to Review"));
    expect(screen.getByText("Review & create")).toBeTruthy();
    vi.mocked(stepBlocker).mockImplementation(actualStepBlocker);

    fireEvent.click(screen.getByRole("button", { name: "Create Cookbook" }));

    expect(screen.getByText("Name your cookbook")).toBeTruthy();
    expect(screen.getByText("Enter a name for your cookbook.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Cookbook name"));
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("CookbookCreateWizard — refused jumps (round 2)", () => {
  it("says the error, not the step, when a refused jump moves to the blocking step", () => {
    renderComponent(<CookbookCreateWizard />);
    walkToReview();
    fireEvent.click(screen.getByLabelText("Edit Recipes"));
    fireEvent.click(screen.getByLabelText("Garlic Lemon Chicken"));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Design your cover")).toBeTruthy();
    mockAnnounce.mockClear();

    fireEvent.click(screen.getByLabelText("Go to Review"));

    expect(screen.getByText("Choose your recipes")).toBeTruthy();
    expect(screen.getByText("Pick at least one recipe.")).toBeTruthy();
    expect(mockAnnounce).not.toHaveBeenCalledWith("Step 3 of 4, Recipes");
  });

  it("still announces a normal step change exactly once", () => {
    renderComponent(<CookbookCreateWizard />);
    walkToReview();
    fireEvent.click(screen.getByLabelText("Edit Recipes"));
    mockAnnounce.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(mockAnnounce).toHaveBeenCalledTimes(1);
    expect(mockAnnounce).toHaveBeenCalledWith("Step 2 of 4, Cover");
  });

  // Pins a defensive branch: production can't return availability to unknown once the sources settle.
  it("won't jump ahead out of Recipes while availability is unknown", () => {
    renderComponent(<CookbookCreateWizard />);
    walkToReview();
    sources.reportUnknown = true;
    fireEvent.click(screen.getByLabelText("Edit Recipes"));
    vi.mocked(Haptics.notificationAsync).mockClear();

    fireEvent.click(screen.getByLabelText("Go to Review"));

    expect(screen.getByText("Choose your recipes")).toBeTruthy();
    expect(screen.queryByText("Pick at least one recipe.")).toBeNull();
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });
});
