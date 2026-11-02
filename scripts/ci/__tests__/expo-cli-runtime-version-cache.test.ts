// Guards patches/expo++@expo+cli+*.patch.
//
// Every dev-client manifest request made @expo/cli spawn a fresh Node process
// (`expo-updates runtimeversion:resolve`). On the CPU-starved macos-26 runner
// that spawn pushed 15-20% of manifest requests past the iOS dev launcher's
// fixed 10s timeout after SDK 58 (nightlies 2026-11-01/02, metro-probe.log),
// up from 3% on SDK 57. The patch resolves once per platform per server.
//
// The test loads the real nested CLI file and swaps its expoUpdatesCli
// dependency through Node's require cache, so it fails if the patch is not
// applied (e.g. a version bump made patch-package skip it).
import Module, { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const cliRoot = path.dirname(
  require.resolve("@expo/cli/package.json", {
    paths: [path.dirname(require.resolve("expo/package.json"))],
  }),
);
const middlewareDir = path.join(cliRoot, "build/src/start/server/middleware");
const resolverPath = path.join(
  middlewareDir,
  "resolveRuntimeVersionWithExpoUpdatesAsync.js",
);
const updatesCliPath = path.join(cliRoot, "build/src/utils/expoUpdatesCli.js");

class ExpoUpdatesCLIModuleNotFoundError extends Error {}

function loadResolver(
  command: (root: string, args: string[]) => Promise<string>,
) {
  const fake = new Module(updatesCliPath);
  fake.filename = updatesCliPath;
  fake.loaded = true;
  fake.exports = {
    expoUpdatesCommandAsync: command,
    ExpoUpdatesCLIModuleNotFoundError,
  };
  require.cache[updatesCliPath] = fake;
  delete require.cache[resolverPath];
  return require(resolverPath)
    .resolveRuntimeVersionWithExpoUpdatesAsync as (o: {
    projectRoot: string;
    platform: string;
  }) => Promise<string | null>;
}

afterEach(() => {
  delete require.cache[updatesCliPath];
  delete require.cache[resolverPath];
});

const ok = JSON.stringify({ runtimeVersion: "5.0.0" });

describe("@expo/cli runtime version resolve (patched)", () => {
  it("spawns the resolver once per platform, not once per manifest request", async () => {
    const command = vi.fn(async () => ok);
    const resolve = loadResolver(command);

    expect(await resolve({ projectRoot: "/p", platform: "ios" })).toBe("5.0.0");
    expect(await resolve({ projectRoot: "/p", platform: "ios" })).toBe("5.0.0");
    expect(command).toHaveBeenCalledTimes(1);

    await resolve({ projectRoot: "/p", platform: "android" });
    expect(command).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight spawn between concurrent requests", async () => {
    const command = vi.fn(async () => ok);
    const resolve = loadResolver(command);

    await Promise.all([
      resolve({ projectRoot: "/p", platform: "ios" }),
      resolve({ projectRoot: "/p", platform: "ios" }),
    ]);
    expect(command).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failure", async () => {
    const command = vi
      .fn<(root: string, args: string[]) => Promise<string>>()
      .mockRejectedValueOnce(new Error("spawn failed"))
      .mockResolvedValueOnce(ok);
    const resolve = loadResolver(command);

    await expect(
      resolve({ projectRoot: "/p", platform: "ios" }),
    ).rejects.toThrow("spawn failed");
    expect(await resolve({ projectRoot: "/p", platform: "ios" })).toBe("5.0.0");
    expect(command).toHaveBeenCalledTimes(2);
  });
});
