// @vitest-environment jsdom
import React from "react";
import { AccessibilityInfo } from "react-native";
import { act } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { ReplacementCodeCard } from "../ReplacementCodeCard";
import { InlineError } from "../InlineError";

vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));

let announce: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers();
  announce = vi.spyOn(AccessibilityInfo, "announceForAccessibility");
});
afterEach(() => {
  announce.mockRestore();
  vi.useRealTimers();
});

describe("ReplacementCodeCard announcement", () => {
  it("alone: announces the new code once", () => {
    renderComponent(<ReplacementCodeCard code="abcd-efgh" onDone={vi.fn()} />);
    act(() => vi.runAllTimers());
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce.mock.calls[0][0]).toContain("abcd-efgh");
  });

  // VoiceOver does not queue: a second announcement in the same moment cuts
  // the first off. A failure that spent a recovery code mounts both at once.
  it("with an error in the same render: ONE announcement, code first", () => {
    renderComponent(
      <>
        <InlineError message="Please sign in again." />
        <ReplacementCodeCard code="abcd-efgh" onDone={vi.fn()} />
      </>,
    );
    act(() => vi.runAllTimers());
    expect(announce).toHaveBeenCalledTimes(1);
    const said = String(announce.mock.calls[0][0]);
    expect(said.indexOf("abcd-efgh")).toBeGreaterThanOrEqual(0);
    expect(said.indexOf("Please sign in again.")).toBeGreaterThan(
      said.indexOf("abcd-efgh"),
    );
  });
});
