// @vitest-environment jsdom
import React from "react";
import { screen, act } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import type { MenuAnalysisItem, MenuAnalysisResult } from "@/hooks/useMenuScan";
import MenuScanResultScreen from "../MenuScanResultScreen";

type ScanCallbacks = {
  onSuccess: (result: MenuAnalysisResult) => void;
  onError: (err: Error) => void;
};

const { mockScanMenu, mockRoute } = vi.hoisted(() => ({
  mockScanMenu: vi.fn(),
  mockRoute: {
    params: { imageUri: "file:///menu.jpg" } as {
      imageUri: string;
      localOCRText?: string;
    },
  },
}));

vi.mock("@react-navigation/native", () => ({
  useRoute: () => mockRoute,
}));

vi.mock("@/hooks/useMenuScan", () => ({
  useMenuScan: () => ({ mutate: mockScanMenu }),
}));

// Parses to 3 items + a restaurant name: confidence 3/5 * 0.8 + 0.2 = 0.68.
const LOCAL_MENU = [
  "The Grill House",
  "Grilled Salmon $18.99",
  "Caesar Salad $12.50",
  "Chicken Burger $14.00",
].join("\n");

function aiItem(name: string): MenuAnalysisItem {
  return {
    name,
    estimatedCalories: 500,
    estimatedProtein: 30,
    estimatedCarbs: 40,
    estimatedFat: 20,
    tags: [],
  };
}

function lastScanCallbacks(): ScanCallbacks {
  return mockScanMenu.mock.calls.at(-1)![1] as ScanCallbacks;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRoute.params = { imageUri: "file:///menu.jpg" };
});

describe("MenuScanResultScreen — local OCR preview", () => {
  it("shows the parsed local items and restaurant name while the AI scan is still pending", () => {
    mockRoute.params = {
      imageUri: "file:///menu.jpg",
      localOCRText: LOCAL_MENU,
    };
    renderComponent(<MenuScanResultScreen />);

    expect(screen.getByText("The Grill House")).toBeDefined();
    expect(screen.getByText("Grilled Salmon")).toBeDefined();
    expect(screen.getByText("Caesar Salad")).toBeDefined();
    expect(screen.getByText("Chicken Burger")).toBeDefined();
    expect(screen.getByText(/3 items found/)).toBeDefined();
    // The preview ends the analysing state: no full-screen spinner, no AI row.
    expect(screen.queryByText("Analysing menu…")).toBeNull();
    expect(screen.queryByText("AI analysis in progress…")).toBeNull();
    expect(mockScanMenu).toHaveBeenCalledWith(
      "file:///menu.jpg",
      expect.any(Object),
    );
  });

  it("shows the analysing state when there is no local OCR text", () => {
    renderComponent(<MenuScanResultScreen />);
    expect(screen.getByText("Analysing menu…")).toBeDefined();
  });

  it("shows the analysing state when the local parse is low-confidence", () => {
    // One item, no restaurant name: confidence 0.16 < 0.5.
    mockRoute.params = {
      imageUri: "file:///menu.jpg",
      localOCRText: "Soup $5.00",
    };
    renderComponent(<MenuScanResultScreen />);
    expect(screen.getByText("Analysing menu…")).toBeDefined();
  });

  it("an AI result with 50%+ more items replaces the preview and says so", () => {
    mockRoute.params = {
      imageUri: "file:///menu.jpg",
      localOCRText: LOCAL_MENU,
    };
    renderComponent(<MenuScanResultScreen />);

    act(() => {
      lastScanCallbacks().onSuccess({
        restaurantName: "Grill House AI",
        menuItems: ["A", "B", "C", "D", "E"].map((n) => aiItem(`Dish ${n}`)),
      } as MenuAnalysisResult);
    });

    expect(screen.getByText("Updated with AI analysis")).toBeDefined();
    expect(screen.getByText("Dish A")).toBeDefined();
    expect(screen.queryByText("Grilled Salmon")).toBeNull();
  });

  it("an AI result that confirms the preview keeps the local names, without the update toast", () => {
    mockRoute.params = {
      imageUri: "file:///menu.jpg",
      localOCRText: LOCAL_MENU,
    };
    renderComponent(<MenuScanResultScreen />);

    act(() => {
      lastScanCallbacks().onSuccess({
        menuItems: [aiItem("grilled salmon"), aiItem("Caesar Salad")],
      } as MenuAnalysisResult);
    });

    expect(screen.queryByText("Updated with AI analysis")).toBeNull();
    expect(screen.getByText("Grilled Salmon")).toBeDefined();
    expect(screen.queryByText("grilled salmon")).toBeNull();
  });

  it("an AI failure after a local preview keeps the preview and shows no error", () => {
    mockRoute.params = {
      imageUri: "file:///menu.jpg",
      localOCRText: LOCAL_MENU,
    };
    renderComponent(<MenuScanResultScreen />);

    act(() => {
      lastScanCallbacks().onError(new Error("boom"));
    });

    expect(screen.getByText("Grilled Salmon")).toBeDefined();
    expect(screen.queryByText("Could not analyse menu.")).toBeNull();
  });

  it("an AI failure with no preview shows the error", () => {
    renderComponent(<MenuScanResultScreen />);

    act(() => {
      lastScanCallbacks().onError(new Error("boom"));
    });

    expect(screen.getByText("Could not analyse menu.")).toBeDefined();
  });
});
