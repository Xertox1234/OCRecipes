import { describe, it, expect } from "vitest";

import {
  formatBuildInfo,
  toCreatedAtIso,
  type BuildInfoInput,
} from "../settings-version-utils";

/**
 * A healthy OTA-updated preview build. Each test overrides only the fields it
 * exercises, so a change to an unrelated field can't silently alter a case.
 */
const OTA_BUILD: BuildInfoInput = {
  appVersion: "1.0.0",
  buildNumber: "4",
  runtimeVersion: "1.2.0",
  channel: "preview",
  updateId: "a1b2c3d4-5e6f-7890-abcd-ef1234567890",
  createdAtIso: "2026-08-12T14:32:00.000Z",
  isEmbeddedLaunch: false,
  isEnabled: true,
};

const build = (over?: Partial<BuildInfoInput>): BuildInfoInput => ({
  ...OTA_BUILD,
  ...over,
});

/** Every degraded input shape, for the "never renders blank" sweep. */
const DEGRADED_INPUTS: BuildInfoInput[] = [
  build({ appVersion: null }),
  build({ buildNumber: null }),
  build({ appVersion: null, buildNumber: null }),
  build({ runtimeVersion: null }),
  build({ channel: null }),
  build({ updateId: null }),
  build({ createdAtIso: null }),
  build({ createdAtIso: "not-a-date" }),
  build({ isEnabled: false }),
  build({ isEmbeddedLaunch: true, channel: null }),
  {
    appVersion: null,
    buildNumber: null,
    runtimeVersion: null,
    channel: null,
    updateId: null,
    createdAtIso: null,
    isEmbeddedLaunch: true,
    isEnabled: false,
  },
];

describe("formatBuildInfo", () => {
  describe("version line", () => {
    it("pairs the app version with the native build number", () => {
      expect(formatBuildInfo(build()).lines[0]).toBe("Version 1.0.0 (4)");
    });

    it("drops the parenthetical when the build number is unavailable", () => {
      expect(formatBuildInfo(build({ buildNumber: null })).lines[0]).toBe(
        "Version 1.0.0",
      );
    });

    it("keeps the build number when only the version is unavailable", () => {
      expect(formatBuildInfo(build({ appVersion: null })).lines[0]).toBe(
        "Version unknown (4)",
      );
    });

    it("says unknown rather than rendering blanks when both are missing", () => {
      expect(
        formatBuildInfo(build({ appVersion: null, buildNumber: null }))
          .lines[0],
      ).toBe("Version unknown");
    });
  });

  describe("runtime line", () => {
    it("pairs runtimeVersion with the update channel", () => {
      expect(formatBuildInfo(build()).lines[1]).toBe(
        "Runtime 1.2.0 · Channel preview",
      );
    });

    it("reports an unstamped channel as none, not as an empty value", () => {
      expect(formatBuildInfo(build({ channel: null })).lines[1]).toBe(
        "Runtime 1.2.0 · Channel none",
      );
    });

    it("treats an empty-string channel the same as an absent one", () => {
      expect(formatBuildInfo(build({ channel: "" })).lines[1]).toBe(
        "Runtime 1.2.0 · Channel none",
      );
    });

    it("says unknown when expo-updates reports no runtimeVersion", () => {
      expect(formatBuildInfo(build({ runtimeVersion: null })).lines[1]).toBe(
        "Runtime unknown · Channel preview",
      );
    });
  });

  // The bundle line is the whole point of this row: it must distinguish a
  // binary that is merely up to date from one that can never be updated.
  describe("bundle line", () => {
    it("names a development build so a dev never reads it as a stale binary", () => {
      expect(formatBuildInfo(build({ isEnabled: false })).lines[2]).toBe(
        "Bundle: development build (updates disabled)",
      );
    });

    it("flags an embedded launch with no channel as permanently un-updatable", () => {
      expect(
        formatBuildInfo(build({ isEmbeddedLaunch: true, channel: null }))
          .lines[2],
      ).toBe(
        "Bundle: embedded — no channel, this build can never receive an OTA",
      );
    });

    it("distinguishes a channel-stamped embedded launch from the un-updatable one", () => {
      expect(
        formatBuildInfo(build({ isEmbeddedLaunch: true, channel: "preview" }))
          .lines[2],
      ).toBe("Bundle: embedded (channel preview, no update applied yet)");
    });

    it("shows the update id prefix and publish time for an applied OTA", () => {
      expect(formatBuildInfo(build()).lines[2]).toBe(
        "Bundle: OTA a1b2c3d4 · 2026-08-12 14:32 UTC",
      );
    });

    it("uses the whole update id when it is shorter than the prefix length", () => {
      expect(formatBuildInfo(build({ updateId: "abc" })).lines[2]).toBe(
        "Bundle: OTA abc · 2026-08-12 14:32 UTC",
      );
    });

    it("omits the publish time rather than printing Invalid Date", () => {
      expect(
        formatBuildInfo(build({ createdAtIso: "not-a-date" })).lines[2],
      ).toBe("Bundle: OTA a1b2c3d4");
    });

    it("omits the publish time when expo-updates supplies none", () => {
      expect(formatBuildInfo(build({ createdAtIso: null })).lines[2]).toBe(
        "Bundle: OTA a1b2c3d4",
      );
    });

    it("says unknown when a non-embedded launch reports no update id", () => {
      expect(formatBuildInfo(build({ updateId: null })).lines[2]).toBe(
        "Bundle: OTA unknown · 2026-08-12 14:32 UTC",
      );
    });
  });

  describe("accessibilityLabel", () => {
    it("reads as prose end-to-end rather than as punctuated fragments", () => {
      expect(formatBuildInfo(build()).accessibilityLabel).toBe(
        "App version 1.0.0, build 4, runtime version 1.2.0, channel preview. " +
          "Currently running over-the-air update a1b2c3d4, published 2026-08-12 14:32 UTC.",
      );
    });

    it("spells out the un-updatable embedded case", () => {
      expect(
        formatBuildInfo(build({ isEmbeddedLaunch: true, channel: null }))
          .accessibilityLabel,
      ).toBe(
        "App version 1.0.0, build 4, runtime version 1.2.0, no channel. " +
          "Currently running the embedded bundle with no channel, so this build cannot receive over-the-air updates.",
      );
    });

    it("spells out the development case", () => {
      expect(
        formatBuildInfo(build({ isEnabled: false })).accessibilityLabel,
      ).toBe(
        "App version 1.0.0, build 4, runtime version 1.2.0, channel preview. " +
          "Currently running a development build with updates disabled.",
      );
    });

    it("never contains the middle-dot separator used by the visual lines", () => {
      for (const input of DEGRADED_INPUTS) {
        expect(formatBuildInfo(input).accessibilityLabel).not.toContain("·");
      }
    });
  });

  describe("clipboardText", () => {
    it("carries the full update id, not the truncated display prefix", () => {
      const { clipboardText } = formatBuildInfo(build());
      expect(clipboardText).toContain(
        "Update ID: a1b2c3d4-5e6f-7890-abcd-ef1234567890",
      );
      expect(clipboardText).toContain("Version: 1.0.0");
      expect(clipboardText).toContain("Build: 4");
      expect(clipboardText).toContain("Runtime: 1.2.0");
      expect(clipboardText).toContain("Channel: preview");
      expect(clipboardText).toContain("Published: 2026-08-12 14:32 UTC");
    });

    it("omits the OTA-only fields when running the embedded bundle", () => {
      const { clipboardText } = formatBuildInfo(
        build({ isEmbeddedLaunch: true }),
      );
      expect(clipboardText).toContain("Bundle: embedded");
      expect(clipboardText).not.toContain("Update ID:");
      expect(clipboardText).not.toContain("Published:");
    });

    it("labels every missing field instead of leaving a dangling colon", () => {
      const { clipboardText } = formatBuildInfo(
        build({
          appVersion: null,
          buildNumber: null,
          runtimeVersion: null,
          channel: null,
        }),
      );
      expect(clipboardText).toContain("Version: unknown");
      expect(clipboardText).toContain("Build: unknown");
      expect(clipboardText).toContain("Runtime: unknown");
      expect(clipboardText).toContain("Channel: none");
      expect(clipboardText).not.toMatch(/:\s*$/m);
    });
  });

  describe("toCreatedAtIso", () => {
    it("serialises a real publish timestamp", () => {
      expect(toCreatedAtIso(new Date("2026-08-12T14:32:00.000Z"))).toBe(
        "2026-08-12T14:32:00.000Z",
      );
    });

    it("returns null when expo-updates supplies no timestamp", () => {
      expect(toCreatedAtIso(null)).toBeNull();
    });

    // `new Date("nonsense").toISOString()` throws RangeError, which would take
    // the whole Settings screen down rather than degrade this one row.
    it("returns null instead of throwing on an unparseable Date", () => {
      expect(() => toCreatedAtIso(new Date("nonsense"))).not.toThrow();
      expect(toCreatedAtIso(new Date("nonsense"))).toBeNull();
    });
  });

  // AC: the row must degrade gracefully in dev — no crash, no empty string.
  describe("degradation", () => {
    it("renders three non-empty lines for every degraded input", () => {
      for (const input of DEGRADED_INPUTS) {
        const { lines } = formatBuildInfo(input);
        expect(lines).toHaveLength(3);
        for (const line of lines) {
          expect(line.trim()).not.toBe("");
        }
      }
    });

    it("never emits null, undefined, or Invalid Date as user-facing text", () => {
      for (const input of DEGRADED_INPUTS) {
        const { lines, accessibilityLabel, clipboardText } =
          formatBuildInfo(input);
        const all = [...lines, accessibilityLabel, clipboardText].join("\n");
        expect(all).not.toContain("null");
        expect(all).not.toContain("undefined");
        expect(all).not.toContain("Invalid Date");
        expect(all).not.toContain("NaN");
      }
    });
  });
});
