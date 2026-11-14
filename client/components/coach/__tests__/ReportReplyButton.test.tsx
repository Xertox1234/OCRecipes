// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import * as RN from "react-native";
import { renderComponent } from "../../../../test/utils/render-component";
import ReportReplyButton from "../ReportReplyButton";

const { mockReport } = vi.hoisted(() => ({ mockReport: vi.fn() }));

vi.mock("@/hooks/useReportChatMessage", () => ({
  useReportChatMessage: () => ({ mutateAsync: mockReport }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockReport.mockResolvedValue(undefined);
});

const openMenu = () =>
  fireEvent.click(screen.getByRole("button", { name: "Report this reply" }));

it("shows only the flag until it is tapped", () => {
  renderComponent(<ReportReplyButton messageId={7} />);
  expect(
    screen.getByRole("button", { name: "Report this reply" }),
  ).toBeTruthy();
  expect(screen.queryByText("Harmful or unsafe")).toBeNull();
});

it("offers the four reasons, and says what is saved and who may read the reply", () => {
  renderComponent(<ReportReplyButton messageId={7} />);
  openMenu();
  for (const label of [
    "Wrong or misleading",
    "Harmful or unsafe",
    "Offensive",
    "Something else",
  ]) {
    expect(screen.getByRole("button", { name: label })).toBeTruthy();
  }
  expect(
    screen.getByText(/We save which reply and your reason, not the text/),
  ).toBeTruthy();
  expect(screen.getByText(/may read this reply/)).toBeTruthy();
});

it("sends the reply id and the reason, then thanks the person", async () => {
  const announce = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
  renderComponent(<ReportReplyButton messageId={7} />);
  openMenu();
  fireEvent.click(screen.getByRole("button", { name: "Harmful or unsafe" }));

  expect(mockReport).toHaveBeenCalledWith({ messageId: 7, reason: "harmful" });
  await waitFor(() =>
    expect(screen.getByText("Reported. Thank you.")).toBeTruthy(),
  );
  expect(announce).toHaveBeenCalledWith("Reported. Thank you.");
  expect(
    screen.queryByRole("button", { name: "Report this reply" }),
  ).toBeNull();
});

it("Cancel closes the menu and sends nothing", () => {
  renderComponent(<ReportReplyButton messageId={7} />);
  openMenu();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(mockReport).not.toHaveBeenCalled();
  expect(screen.queryByText("Harmful or unsafe")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Report this reply" }),
  ).toBeTruthy();
});

it("a failed send says so and keeps the menu open to try again", async () => {
  mockReport.mockRejectedValueOnce(new Error("offline"));
  renderComponent(<ReportReplyButton messageId={7} />);
  openMenu();
  fireEvent.click(screen.getByRole("button", { name: "Offensive" }));

  await waitFor(() =>
    expect(
      screen.getByText("Couldn't send the report. Please try again."),
    ).toBeTruthy(),
  );
  expect(screen.getByRole("button", { name: "Offensive" })).toBeTruthy();
});

it("a second tap while sending does not send twice", () => {
  mockReport.mockReturnValue(new Promise(() => {}));
  renderComponent(<ReportReplyButton messageId={7} />);
  openMenu();
  fireEvent.click(screen.getByRole("button", { name: "Offensive" }));
  fireEvent.click(screen.getByRole("button", { name: "Harmful or unsafe" }));
  expect(mockReport).toHaveBeenCalledTimes(1);
});
