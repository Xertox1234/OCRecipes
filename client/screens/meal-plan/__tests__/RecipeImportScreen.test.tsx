// @vitest-environment jsdom
import React from "react";
import {
  screen,
  fireEvent,
  waitFor,
  act,
  cleanup,
} from "@testing-library/react";
import * as Haptics from "expo-haptics";

import { ApiError } from "@/lib/api-error";
import { ErrorCode } from "@shared/constants/error-codes";
import { renderComponent } from "../../../../test/utils/render-component";
import RecipeImportScreen from "../RecipeImportScreen";

vi.mock("@/hooks/useFeatureTip", () => ({
  useMarkFeatureUsed: (feature: string) => mockMarkFeatureUsed(feature),
}));
const mockMarkFeatureUsed = vi.hoisted(() => vi.fn());

const {
  mockReplace,
  mockParse,
  mockGoBack,
  mockPopTo,
  mockGetState,
  mockSetOptions,
  mockParentNavigate,
  mockRouteParams,
  mockNavigate,
  mockParsePage,
  webViewProps,
} = vi.hoisted(() => ({
  mockReplace: vi.fn(),
  mockParse: vi.fn(),
  mockGoBack: vi.fn(),
  mockPopTo: vi.fn(),
  mockGetState: vi.fn(),
  mockSetOptions: vi.fn(),
  mockParentNavigate: vi.fn(),
  mockRouteParams: vi.fn(),
  mockNavigate: vi.fn(),
  mockParsePage: vi.fn(),
  webViewProps: { current: null as null | Record<string, unknown> },
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    replace: mockReplace,
    navigate: mockNavigate,
    goBack: mockGoBack,
    popTo: mockPopTo,
    getState: mockGetState,
    setOptions: mockSetOptions,
    setParams: vi.fn(),
    dispatch: vi.fn(),
    addListener: vi.fn(() => () => {}),
    getParent: () => ({ navigate: mockParentNavigate }),
  }),
  useRoute: () => ({ params: mockRouteParams() }),
  usePreventRemove: vi.fn(),
}));

vi.mock("@/hooks/useMealPlanRecipes", () => ({
  useParseRecipeFromUrl: () => ({ mutateAsync: mockParse }),
  useParseRecipeFromPage: () => ({ mutateAsync: mockParsePage }),
}));

vi.mock("@/lib/import-browser/ImportWebView", () => ({
  ImportWebView: (props: Record<string, unknown>) => {
    webViewProps.current = props;
    return <div data-testid="import-webview" />;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockRouteParams.mockReturnValue(undefined);
  webViewProps.current = null;
});

// Spec §5.1: Import is pressable with an empty link; pressing it names the
// field, moves focus there and buzzes — and never parses.
describe("RecipeImportScreen — empty link", () => {
  it("Import with no link flags and focuses it, buzzes, and never parses", () => {
    renderComponent(<RecipeImportScreen />);
    const button = screen.getByRole("button", { name: "Import recipe" });
    expect(button.getAttribute("aria-disabled")).not.toBe("true");
    fireEvent.click(button);

    expect(screen.getByText("Paste a recipe link.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Recipe link"));
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
    expect(mockParse).not.toHaveBeenCalled();
  });

  it("a pasted link imports", async () => {
    mockParse.mockResolvedValue({ title: "Soup" });
    renderComponent(<RecipeImportScreen />);
    fireEvent.change(screen.getByLabelText("Recipe link"), {
      target: { value: " https://example.com/soup " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import recipe" }));
    await waitFor(() =>
      expect(mockParse).toHaveBeenCalledWith("https://example.com/soup"),
    );
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
  });
});

describe("RecipeImportScreen — teaching tips", () => {
  it("marks recipe import as used when the screen opens", () => {
    renderComponent(<RecipeImportScreen />);
    expect(mockMarkFeatureUsed).toHaveBeenCalledWith("import");
  });
});

/** Pull the headerLeft element the screen registered via setOptions. */
function renderHeaderLeft() {
  const call = mockSetOptions.mock.calls.at(-1)?.[0] as
    | { headerBackVisible?: boolean; headerLeft?: () => React.ReactElement }
    | undefined;
  expect(call?.headerBackVisible).toBe(false);
  expect(call?.headerLeft).toBeTypeOf("function");
  return call!.headerLeft!();
}

// Reached from Home before the Plan tab was ever opened, this screen is the
// only route in the Plan stack — no native back chevron, so without its own
// close control it was a dead end.
describe("RecipeImportScreen — leaving the screen", () => {
  it("from Home, as the only route: closes back to Home", () => {
    mockGetState.mockReturnValue({
      index: 0,
      routes: [{ key: "import-1", name: "RecipeImport" }],
    });
    mockRouteParams.mockReturnValue({ fromHome: true });
    renderComponent(<RecipeImportScreen />);
    renderComponent(renderHeaderLeft());

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(mockPopTo).toHaveBeenCalledWith("MealPlanHome");
    expect(mockParentNavigate).toHaveBeenCalledWith("HomeTab");
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it("within Plan, with a route beneath: goes back", () => {
    mockGetState.mockReturnValue({
      index: 1,
      routes: [
        { key: "hub-1", name: "RecipeEntryHub" },
        { key: "import-1", name: "RecipeImport" },
      ],
    });
    renderComponent(<RecipeImportScreen />);
    renderComponent(renderHeaderLeft());

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(mockGoBack).toHaveBeenCalled();
    expect(mockPopTo).not.toHaveBeenCalled();
    expect(mockParentNavigate).not.toHaveBeenCalled();
  });
});

const failWith = (code: string) => new ApiError(`422: x`, code, 422);

async function startImport() {
  renderComponent(<RecipeImportScreen />);
  fireEvent.change(screen.getByLabelText("Recipe link"), {
    target: { value: "https://www.allrecipes.com/soup" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Import recipe" }));
}

function triggerBlocks(blocks: string[], url: string) {
  act(() => {
    (webViewProps.current!.onBlocks as (b: string[], u: string) => void)(
      blocks,
      url,
    );
  });
}

describe("RecipeImportScreen — on-device fallback", () => {
  it("server success navigates to RecipeCreate without mounting the WebView", async () => {
    mockParse.mockResolvedValue({ title: "Soup" });
    await startImport();
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expect(screen.queryByTestId("import-webview")).toBeNull();
  });

  it("FETCH_FAILED mounts the hidden WebView, sends blocks with the final URL, and navigates", async () => {
    mockParse.mockRejectedValue(failWith(ErrorCode.FETCH_FAILED));
    mockParsePage.mockResolvedValue({ title: "Soup" });
    await startImport();
    await screen.findByTestId("import-webview");
    expect(webViewProps.current!.hidden).toBe(true);
    expect(webViewProps.current!.url).toBe("https://www.allrecipes.com/soup");

    triggerBlocks(["{}"], "https://www.allrecipes.com/recipe/1/soup/");
    await waitFor(() =>
      expect(mockParsePage).toHaveBeenCalledWith({
        url: "https://www.allrecipes.com/recipe/1/soup/",
        ldJson: ["{}"],
      }),
    );
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith(
        "RecipeCreate",
        expect.objectContaining({ prefill: { title: "Soup" } }),
      ),
    );
  });

  it("ignores an empty first page and waits for one with blocks", async () => {
    mockParse.mockRejectedValue(failWith(ErrorCode.NO_RECIPE_DATA));
    mockParsePage.mockResolvedValue({ title: "Soup" });
    await startImport();
    await screen.findByTestId("import-webview");
    triggerBlocks([], "https://short.link/x");
    expect(mockParsePage).not.toHaveBeenCalled();
    triggerBlocks(["{}"], "https://www.allrecipes.com/soup");
    await waitFor(() => expect(mockParsePage).toHaveBeenCalledTimes(1));
  });

  it("parse-page failure shows the sign-in sheet with the exact copy", async () => {
    mockParse.mockRejectedValue(failWith(ErrorCode.FETCH_FAILED));
    mockParsePage.mockRejectedValue(failWith(ErrorCode.NO_RECIPE_DATA));
    mockRouteParams.mockReturnValue({
      returnToMealPlan: { mealType: "dinner", plannedDate: "2026-11-09" },
    });
    await startImport();
    await screen.findByTestId("import-webview");
    triggerBlocks(["{}"], "https://www.allrecipes.com/soup");

    await screen.findByText("We couldn't read this recipe");
    expect(
      screen.getByText(
        "The site may need you to sign in. Open it here, sign in, and we'll import it.",
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId("import-webview")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Open site and sign in" }),
    );
    expect(mockNavigate).toHaveBeenCalledWith("RecipeImportBrowser", {
      url: "https://www.allrecipes.com/soup",
      returnToMealPlan: { mealType: "dinner", plannedDate: "2026-11-09" },
      fromHome: undefined,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Use a photo or paste instead" }),
    );
    expect(mockNavigate).toHaveBeenCalledWith("RecipeEntryHub", {
      returnToMealPlan: { mealType: "dinner", plannedDate: "2026-11-09" },
    });
  });

  it("15 s with no blocks shows the sign-in sheet", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockParse.mockRejectedValue(failWith(ErrorCode.TIMEOUT));
      await startImport();
      await screen.findByTestId("import-webview");
      act(() => {
        vi.advanceTimersByTime(15_000);
      });
      await screen.findByText("We couldn't read this recipe");
      expect(mockParsePage).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("RATE_LIMITED shows the existing error state, no WebView", async () => {
    mockParse.mockRejectedValue(failWith(ErrorCode.RATE_LIMITED));
    await startImport();
    await screen.findByText("Import Failed");
    expect(screen.queryByTestId("import-webview")).toBeNull();
  });

  it("unmounting during device fallback does not navigate", async () => {
    let resolvePage!: (v: unknown) => void;
    mockParse.mockRejectedValue(failWith(ErrorCode.FETCH_FAILED));
    mockParsePage.mockReturnValue(new Promise((r) => (resolvePage = r)));
    renderComponent(<RecipeImportScreen />);
    fireEvent.change(screen.getByLabelText("Recipe link"), {
      target: { value: "https://www.allrecipes.com/soup" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import recipe" }));
    await screen.findByTestId("import-webview");
    triggerBlocks(["{}"], "https://www.allrecipes.com/soup");
    await waitFor(() => expect(mockParsePage).toHaveBeenCalled());
    cleanup();
    await act(async () => {
      resolvePage({ title: "Soup" });
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
