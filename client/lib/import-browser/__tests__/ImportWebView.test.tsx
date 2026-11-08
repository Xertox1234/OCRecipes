// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";
import { renderComponent } from "../../../../test/utils/render-component";
import { getLastWebViewProps } from "../../../../test/mocks/react-native-webview";
import { ImportWebView } from "../ImportWebView";

describe("ImportWebView lockdown", () => {
  it("passes the locked-down props and gates navigation", () => {
    renderComponent(
      <ImportWebView url="https://a.test/r" hidden onBlocks={() => {}} />,
    );
    const props = getLastWebViewProps();
    // "*" is deliberate: a whitelist miss is handed to Linking.openURL by the
    // library, so shouldAllowNavigation must be the only gate.
    expect(props.originWhitelist).toEqual(["*"]);
    expect(props.setSupportMultipleWindows).toBe(false);
    expect(props.allowFileAccess).toBe(false);
    expect(props.thirdPartyCookiesEnabled).toBe(false);
    expect(props.sharedCookiesEnabled).toBe(false);
    expect("userAgent" in props).toBe(false);
    const gate = props.onShouldStartLoadWithRequest as (r: unknown) => boolean;
    expect(gate({ url: "ocrecipes://x", isTopFrame: true })).toBe(false);
    expect(gate({ url: "https://a.test", isTopFrame: true })).toBe(true);
  });
});
