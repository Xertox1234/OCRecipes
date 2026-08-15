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
  /** `false` in dev clients and Expo Go, where every other field is unreliable. */
  isEnabled: boolean;
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
 * line. Two embedded states look identical on screen but mean opposite things,
 * so they get distinct copy:
 *
 * - **no channel stamped** (a local `expo run:` build) — this binary can never
 *   receive an OTA at all, no matter what is published;
 * - **channel stamped, still embedded** — the OTA lane is healthy and simply
 *   has nothing newer to hand over.
 *
 * Collapsing both into "embedded bundle" would reproduce the ambiguity the
 * block was added to remove.
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

  if (!isEnabled) {
    bundleLine = "Bundle: updates disabled";
    bundleSpoken = "a build with updates disabled";
    bundleClipboard = "updates disabled";
  } else if (!isEmbeddedLaunch && !updateId) {
    // Neither an embedded bundle nor an applied update means there is no
    // packaged bundle at all — the JS is coming off a Metro dev server.
    // Measured on the iOS Simulator 2026-08-14: a dev client reports
    // `isEnabled: true` here, so keying dev off `isEnabled` alone silently
    // mislabels every local run as an OTA with an unknown id.
    bundleLine = "Bundle: development server (not a packaged build)";
    bundleSpoken = "from the development server, not a packaged build";
    bundleClipboard = "development server (not a packaged build)";
  } else if (isEmbeddedLaunch && !hasChannel) {
    bundleLine =
      "Bundle: embedded — no channel, this build can never receive an OTA";
    bundleSpoken =
      "the embedded bundle with no channel, so this build cannot receive over-the-air updates";
    bundleClipboard = "embedded (no channel, cannot receive OTA)";
  } else if (isEmbeddedLaunch) {
    bundleLine = `Bundle: embedded (channel ${channelName}, no update applied yet)`;
    bundleSpoken = `the embedded bundle on channel ${channelName}, no update applied yet`;
    bundleClipboard = "embedded (no update applied yet)";
  } else {
    bundleLine = publishedAt
      ? `Bundle: OTA ${updateIdPrefix} · ${publishedAt}`
      : `Bundle: OTA ${updateIdPrefix}`;
    bundleSpoken = publishedAt
      ? `over-the-air update ${updateIdPrefix}, published ${publishedAt}`
      : `over-the-air update ${updateIdPrefix}`;
    bundleClipboard = "OTA";
    isOtaLaunch = true;
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
