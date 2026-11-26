// @vitest-environment jsdom
//
// Coach chat audit 2026-11-24 L33: the weekly-report settings switches showed
// ON while the settings loaded, sat disabled and ON for good when the load
// failed (no message, no retry), and the push switch was dimmed whenever the
// report was off with nothing saying why.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { reactProps } from "../../../test/utils/react-props";
import WeeklyReportsScreen from "../WeeklyReportsScreen";

const { settings, update } = vi.hoisted(() => ({
  settings: {
    value: {
      data: undefined as
        | { reportEnabled: boolean; pushEnabled: boolean }
        | undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    },
  },
  update: {
    value: {
      mutate: vi.fn(),
      isPending: false,
      variables: undefined as
        | Partial<{ reportEnabled: boolean; pushEnabled: boolean }>
        | undefined,
    },
  },
}));

vi.mock("@/hooks/useWeeklyReports", () => ({
  useWeeklyReports: () => ({
    data: { reports: [], trends: [] },
    isError: false,
    refetch: vi.fn(),
  }),
  useWeeklyReport: () => ({ data: undefined }),
  useWeeklyReportSettings: () => settings.value,
  useUpdateWeeklyReportSettings: () => update.value,
}));
vi.mock("@/components/weekly-report/TrendsCard", () => ({
  TrendsCard: () => null,
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
}));
vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

const loaded = (data: { reportEnabled: boolean; pushEnabled: boolean }) => ({
  data,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
});

function switchOf(name: string) {
  return screen.getByRole("switch", { name }) as HTMLInputElement;
}

beforeEach(() => {
  settings.value = {
    data: undefined,
    isLoading: true,
    isError: false,
    refetch: vi.fn(),
  };
  update.value = { mutate: vi.fn(), isPending: false, variables: undefined };
});

describe("WeeklyReportsScreen — settings", () => {
  it("shows a loading state, not switches that read on", () => {
    renderComponent(<WeeklyReportsScreen />);
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    // The ActivityIndicator mock passes the label through unmapped.
    expect(reactProps(screen.getByRole("progressbar")).accessibilityLabel).toBe(
      "Loading report settings",
    );
  });

  it("says the load failed and offers a retry", () => {
    const refetch = vi.fn();
    settings.value = {
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    };
    renderComponent(<WeeklyReportsScreen />);
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(
      screen.getByText("Couldn't load your report settings."),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry loading report settings" }),
    );
    expect(refetch).toHaveBeenCalled();
  });

  it("shows the saved values once loaded", () => {
    settings.value = loaded({ reportEnabled: true, pushEnabled: false });
    renderComponent(<WeeklyReportsScreen />);
    expect(switchOf("Weekly report").checked).toBe(true);
    expect(switchOf("Push notification").checked).toBe(false);
  });

  it("says why the push switch is off-limits while the report is off", () => {
    settings.value = loaded({ reportEnabled: false, pushEnabled: true });
    renderComponent(<WeeklyReportsScreen />);
    const push = switchOf("Push notification");
    expect(push.disabled).toBe(true);
    expect(push.getAttribute("aria-hint")).toBe(
      "Turn on the weekly report first.",
    );
    expect(screen.getByText("Turn on the weekly report first.")).toBeTruthy();
  });

  it("shows a change being saved at its new value", () => {
    settings.value = loaded({ reportEnabled: true, pushEnabled: true });
    update.value = {
      mutate: vi.fn(),
      isPending: true,
      variables: { pushEnabled: false },
    };
    renderComponent(<WeeklyReportsScreen />);
    expect(switchOf("Push notification").checked).toBe(false);
    expect(switchOf("Weekly report").checked).toBe(true);
  });
});
