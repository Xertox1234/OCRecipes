/**
 * Pure formatting for the Settings screen's build-diagnostics block.
 * No React, RN, or `expo-*` imports — `SettingsScreen` reads the native and
 * update values and hands them in as plain data, so Vitest can cover every
 * branch without `expo-modules-core` in the graph.
 */

/**
 * The subset of `expo-application` / `expo-updates` this needs, declared
 * locally rather than imported so the module stays free of native deps.
 *
 * `appVersion`/`buildNumber` must come from `expo-application`
 * (`nativeApplicationVersion`/`nativeBuildVersion`), NOT `expo-constants`:
 * `Constants.expoConfig` describes the running *manifest*, so after an OTA it
 * reports the update's version rather than the installed binary's — precisely
 * the confusion this block exists to end.
 */
export interface BuildInfoInput {
  appVersion: string | null;
  buildNumber: string | null;
  runtimeVersion: string | null;
  channel: string | null;
  updateId: string | null;
  /** `Updates.createdAt` pre-serialised by the caller, keeping this pure data. */
  createdAtIso: string | null;
  isEmbeddedLaunch: boolean;
  /** `Updates.isEnabled` — false only when updates were compiled out. */
  isEnabled: boolean;
  /**
   * `__DEV__`. The only POSITIVE signal that this is a development build.
   * Every `Updates.*` field is unreliable here — a Metro-served dev client
   * reports `isEnabled: true` with a null `updateId`, and expo-updates
   * documents `channel` as always null on dev builds — so dev must be
   * identified by this, never inferred from the absence of the others.
   */
  isDevelopment: boolean;
  /** `Updates.isEmergencyLaunch` — an update downloaded but threw on launch. */
  isEmergencyLaunch: boolean;
  emergencyLaunchReason: string | null;
}

export interface BuildInfoDisplay {
  /** One `<ThemedText>` per entry. Always three, always non-empty. */
  lines: string[];
  /** Prose for the single a11y node — no separators a screen reader mangles. */
  accessibilityLabel: string;
  /** Structured `key: value` block, pasteable straight into a bug report. */
  clipboardText: string;
}

/** Enough of a UUID to identify an update without dominating the row. */
const UPDATE_ID_DISPLAY_LENGTH = 8;

/**
 * `YYYY-MM-DD HH:mm UTC`. Deliberately not `toLocaleString` — that differs
 * between Hermes and Node, so the unit tests could never pin it, and a bug
 * report wants an unambiguous absolute time rather than a friendly one.
 *
 * Returns `null` for absent *or* unparseable input; every caller drops the
 * segment entirely rather than rendering `Invalid Date` at the user.
 */
function formatUtcTimestamp(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * Narrows `Updates.createdAt` to the plain string `formatBuildInfo` takes.
 *
 * Lives here rather than inline at the call site because the naive
 * `Updates.createdAt?.toISOString() ?? null` **throws** `RangeError: Invalid
 * time value` when the manifest carried an unparseable timestamp — crashing
 * Settings instead of degrading it, in exactly the OTA state this block is
 * meant to diagnose. Keeping the guard in this module keeps it unit-tested.
 */
export function toCreatedAtIso(createdAt: Date | null): string | null {
  if (!createdAt || Number.isNaN(createdAt.getTime())) return null;
  return createdAt.toISOString();
}

/**
 * Composes the three-line build-diagnostics block shown at the bottom of
 * Settings, plus its spoken label and its clipboard payload.
 *
 * The third line is the load-bearing one. `expo-updates` matches
 * `runtimeVersion` *exactly*, so a binary older than the published
 * `runtimeVersion` keeps its embedded bundle forever with no error and no log
 * line. Several states render as "the embedded bundle" yet mean entirely
 * different things, so each gets its own branch rather than collapsing into
 * one reassuring label:
 *
 * - **development build** — nothing below is meaningful; identified by
 *   `__DEV__` alone, never inferred from the `Updates.*` fields;
 * - **updates disabled** — compiled out;
 * - **emergency launch** — an update downloaded and *failed to run*; the lane
 *   is broken, which is the opposite of "nothing newer yet";
 * - **no channel stamped** (a release `expo run:` build) — can never receive
 *   an OTA at all, no matter what is published;
 * - **channel stamped, still embedded** — the lane is healthy and simply has
 *   nothing newer to hand over;
 * - **no launch source at all** — reported as unknown rather than assumed.
 *
 * Collapsing any pair of these would reproduce the ambiguity the block was
 * added to remove.
 */
export function formatBuildInfo(input: BuildInfoInput): BuildInfoDisplay {
  const {
    appVersion,
    buildNumber,
    runtimeVersion,
    channel,
    updateId,
    createdAtIso,
    isEmbeddedLaunch,
    isEnabled,
    isDevelopment,
    isEmergencyLaunch,
    emergencyLaunchReason,
  } = input;

  const version = appVersion ?? "unknown";
  const runtime = runtimeVersion ?? "unknown";
  // `||` not `??`: an empty-string channel is as unstamped as a null one.
  const hasChannel = Boolean(channel);
  const channelName = channel || "none";
  const updateIdPrefix = updateId
    ? updateId.slice(0, UPDATE_ID_DISPLAY_LENGTH)
    : "unknown";
  const publishedAt = formatUtcTimestamp(createdAtIso);

  const versionLine = buildNumber
    ? `Version ${version} (${buildNumber})`
    : `Version ${version}`;
  const runtimeLine = `Runtime ${runtime} · Channel ${channelName}`;

  let bundleLine: string;
  let bundleSpoken: string;
  let bundleClipboard: string;
  let isOtaLaunch = false;

  // Order matters. `isDevelopment` comes first because every Updates.* field
  // below is unreliable on a dev build, and the no-channel branch would
  // otherwise tell a dev-build tester a flat falsehood (see that branch).
  if (isDevelopment) {
    bundleLine = "Bundle: development build (update state not meaningful)";
    bundleSpoken =
      "a development build, where the update state is not meaningful";
    bundleClipboard = "development build (update state not meaningful)";
  } else if (!isEnabled) {
    bundleLine = "Bundle: updates disabled";
    bundleSpoken = "a build with updates disabled";
    bundleClipboard = "updates disabled";
  } else if (isEmergencyLaunch) {
    // An update downloaded, threw on launch, and expo-updates fell back to the
    // embedded bundle. This is *not* "no update applied yet" — reporting it as
    // a healthy lane tells the bug reporter the opposite of the truth at the
    // exact moment the lane is broken.
    const reason = emergencyLaunchReason?.trim();
    bundleLine = reason
      ? `Bundle: embedded after a failed update — ${reason}`
      : "Bundle: embedded after a failed update";
    bundleSpoken = reason
      ? `the embedded bundle after an update failed to launch: ${reason}`
      : "the embedded bundle after an update failed to launch";
    bundleClipboard = reason
      ? `embedded after a failed update (${reason})`
      : "embedded after a failed update";
  } else if (isEmbeddedLaunch && !hasChannel) {
    // Only reachable on a RELEASE build, which is what makes the claim safe:
    // expo-updates documents `channel` as always null on Expo Go and dev
    // builds, which "can run any updates compatible with their native
    // runtime" — so this hard "never" would be false for them.
    bundleLine =
      "Bundle: embedded — no channel, this build can never receive an OTA";
    bundleSpoken =
      "the embedded bundle with no channel, so this build cannot receive over-the-air updates";
    bundleClipboard = "embedded (no channel, cannot receive OTA)";
  } else if (isEmbeddedLaunch) {
    bundleLine = `Bundle: embedded (channel ${channelName}, no update applied yet)`;
    bundleSpoken = `the embedded bundle on channel ${channelName}, no update applied yet`;
    bundleClipboard = "embedded (no update applied yet)";
  } else if (updateId) {
    bundleLine = publishedAt
      ? `Bundle: OTA ${updateIdPrefix} · ${publishedAt}`
      : `Bundle: OTA ${updateIdPrefix}`;
    bundleSpoken = publishedAt
      ? `over-the-air update ${updateIdPrefix}, published ${publishedAt}`
      : `over-the-air update ${updateIdPrefix}`;
    bundleClipboard = "OTA";
    isOtaLaunch = true;
  } else {
    // Neither embedded nor an applied update, on a non-dev build. Say so
    // plainly rather than defaulting into the OTA branch and asserting an
    // update that was never established.
    bundleLine = "Bundle: unknown (no launch source reported)";
    bundleSpoken = "an unknown bundle — no launch source was reported";
    bundleClipboard = "unknown (no launch source reported)";
  }

  const versionSpoken = buildNumber
    ? `App version ${version}, build ${buildNumber}`
    : `App version ${version}`;
  const channelSpoken = hasChannel ? `channel ${channelName}` : "no channel";
  const accessibilityLabel =
    `${versionSpoken}, runtime version ${runtime}, ${channelSpoken}. ` +
    `Currently running ${bundleSpoken}.`;

  const clipboardLines = [
    "OCRecipes build details",
    `Version: ${version}`,
    `Build: ${buildNumber ?? "unknown"}`,
    `Runtime: ${runtime}`,
    `Channel: ${channelName}`,
    `Bundle: ${bundleClipboard}`,
  ];
  // The full id, not the display prefix — a bug report needs the whole thing.
  if (isOtaLaunch) {
    clipboardLines.push(`Update ID: ${updateId ?? "unknown"}`);
    if (publishedAt) clipboardLines.push(`Published: ${publishedAt}`);
  }

  return {
    lines: [versionLine, runtimeLine, bundleLine],
    accessibilityLabel,
    clipboardText: clipboardLines.join("\n"),
  };
}
