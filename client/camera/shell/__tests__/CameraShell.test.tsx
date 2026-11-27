// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Text } from "react-native";
import { CameraShell } from "../CameraShell";

function renderShell(props: { obscured?: boolean; feedHeld?: boolean }) {
  return render(
    <CameraShell
      camera={null}
      frame={null}
      overlay={<Text>Example card</Text>}
      onClose={vi.fn()}
      title={null}
      onHelp={vi.fn()}
      hint={<Text>Fit the whole panel in the frame</Text>}
      tabs={<Text>Tabs</Text>}
      left={<Text>Torch</Text>}
      shutter={<Text>Shutter</Text>}
      right={<Text>Skip</Text>}
      {...props}
    />,
  );
}

const hidden = (testID: string) =>
  screen.getByTestId(testID).getAttribute("aria-hidden");

describe("CameraShell", () => {
  // The example card is rendered BEFORE the chrome, and iOS
  // accessibilityViewIsModal hides only earlier siblings
  // (docs/solutions/logic-errors/accessibilityviewismodal-later-siblings-stay-accessible-2026-08-17.md),
  // so the shell itself must hide the top bar, hint, tabs and controls — no
  // staticUIImportance passed here.
  it("hides the top bar, hint, tabs and controls while obscured", () => {
    renderShell({ obscured: true });
    expect(hidden("scan-top-overlay")).toBe("true");
    expect(hidden("scan-hint")).toBe("true");
    expect(hidden("scan-tabs")).toBe("true");
    expect(hidden("scan-controls")).toBe("true");
  });

  it("leaves them reachable otherwise", () => {
    renderShell({});
    expect(hidden("scan-top-overlay")).toBeNull();
    expect(hidden("scan-hint")).toBeNull();
    expect(hidden("scan-tabs")).toBeNull();
    expect(hidden("scan-controls")).toBeNull();
  });

  // Spec: "On detection, the camera pauses". The feed dims behind the frame
  // while a barcode is locked; detection itself is not touched.
  it("holds the feed under a dim layer while feedHeld", () => {
    renderShell({ feedHeld: true });
    const hold = screen.getByTestId("scan-feed-hold");
    expect(hold.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps the dim layer at zero opacity when the feed is live", () => {
    renderShell({});
    const hold = screen.queryByTestId("scan-feed-hold");
    // Mounted so it can fade, but invisible.
    expect(hold?.style.opacity ?? "0").toBe("0");
  });
});
