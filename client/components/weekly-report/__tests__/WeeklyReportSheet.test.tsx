// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { WeeklyReportPopupHost } from "../WeeklyReportSheet";

const state = vi.hoisted(() => ({
  pending: null as { report: { id: number } | null } | null,
  pendingUpdatedAt: 1,
  claim: vi.fn(),
  report: undefined as unknown,
  failingId: 0,
}));

vi.mock("expo-notifications", () => ({
  addNotificationReceivedListener: () => ({ remove: () => {} }),
}));
vi.mock("@/navigation/navigationRef", () => ({
  navigationRef: { isReady: () => false, navigate: vi.fn() },
}));
vi.mock("@/hooks/useWeeklyReports", () => ({
  usePendingWeeklyPopup: () => ({
    data: state.pending,
    dataUpdatedAt: state.pendingUpdatedAt,
  }),
  useMarkPopupShown: () => ({ mutateAsync: state.claim }),
  useWeeklyReport: (id: number) => ({
    data: id > 0 ? state.report : undefined,
    isError: id > 0 && id === state.failingId,
  }),
}));

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  state.pending = null;
  state.pendingUpdatedAt = 1;
  state.claim.mockReset();
  state.report = undefined;
  state.failingId = 0;
});

describe("WeeklyReportPopupHost", () => {
  // Audit 2026-11-24 L60: the foreground refetch returns the same report, so
  // the data reference does not change; the claim must still be retried.
  it("retries a failed popup claim when the pending report is fetched again", async () => {
    state.pending = { report: { id: 7 } };
    state.claim.mockRejectedValueOnce(new Error("offline"));
    const view = renderComponent(<WeeklyReportPopupHost />);
    await flush();
    expect(state.claim).toHaveBeenCalledTimes(1);

    state.claim.mockResolvedValueOnce(true);
    state.pendingUpdatedAt = 2; // same data, a fresh fetch
    view.rerender(<WeeklyReportPopupHost />);
    await flush();
    expect(state.claim).toHaveBeenCalledTimes(2);
    expect(state.claim).toHaveBeenLastCalledWith(7);
  });

  it("does not claim again without a fresh fetch (control)", async () => {
    state.pending = { report: { id: 7 } };
    state.claim.mockRejectedValueOnce(new Error("offline"));
    const view = renderComponent(<WeeklyReportPopupHost />);
    await flush();
    view.rerender(<WeeklyReportPopupHost />);
    await flush();
    expect(state.claim).toHaveBeenCalledTimes(1);
  });

  // Audit 2026-11-24 L82: a claimed report that fails to load used to leave
  // the host blocked, so no later popup could show until a restart.
  it("a report that fails to load frees the host for the next popup", async () => {
    state.pending = { report: { id: 7 } };
    state.claim.mockResolvedValue(true);
    state.failingId = 7;
    const view = renderComponent(<WeeklyReportPopupHost />);
    await flush();
    expect(state.claim).toHaveBeenCalledWith(7);

    // Report 7's query stays failed, as it would in the app.
    state.pending = { report: { id: 8 } };
    state.pendingUpdatedAt = 2;
    view.rerender(<WeeklyReportPopupHost />);
    await flush();
    expect(state.claim).toHaveBeenLastCalledWith(8);
  });
});
