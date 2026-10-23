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
});
