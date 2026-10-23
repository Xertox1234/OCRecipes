import { describe, it, expect } from "vitest";
import appJson from "../../app.json";

const pluginNames = appJson.expo.plugins.map((p) =>
  Array.isArray(p) ? p[0] : p,
);

describe("app.json", () => {
  // Push is on from SDK 55: the paid Apple account can provision
  // aps-environment, so expo-notifications' entitlement must reach the build.
  it("does not strip the push entitlement", () => {
    expect(pluginNames).not.toContain("./plugins/strip-push-entitlement");
  });

  // SDK 55's dev client draws a floating Tools button over the top-right
  // corner, on top of ProfileCard's Settings gear, so E2E taps on
  // "Settings" open the dev menu instead. The dev menu still opens by shake
  // or Cmd+D.
  it("hides the dev client's floating Tools button", () => {
    const devClient = appJson.expo.plugins.find(
      (p) => Array.isArray(p) && p[0] === "expo-dev-client",
    );
    expect(devClient).toEqual(["expo-dev-client", { toolsButton: false }]);
  });
});
