import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import withIosPodfileFixes from "../ios-podfile-fixes";

const { applyPodfileFixes } = withIosPodfileFixes;

// The stock Podfile `expo prebuild` starts from — read from the installed
// SDK's template, so an SDK upgrade that moves an anchor fails here first.
const stockPodfile = execFileSync(
  "tar",
  ["-xOzf", "node_modules/expo/template.tgz", "package/ios/Podfile"],
  { encoding: "utf8" },
);

describe("ios-podfile-fixes plugin", () => {
  const out = applyPodfileFixes(stockPodfile);

  it("loads our post_install hooks file relative to ios/", () => {
    expect(out).toContain(
      "require_relative '../plugins/ios/ocrecipes_post_install'",
    );
  });

  it("adds the GoogleSignIn modular-header pods inside the app target, before post_install", () => {
    const pods = out.indexOf("pod 'GoogleUtilities', :modular_headers => true");
    const recaptcha = out.indexOf(
      "pod 'RecaptchaInterop', :modular_headers => true",
    );
    const target = out.indexOf("target 'HelloWorld' do");
    const postInstall = out.indexOf("post_install do |installer|");
    expect(pods).toBeGreaterThan(target);
    expect(recaptcha).toBeGreaterThan(target);
    expect(pods).toBeLessThan(postInstall);
    expect(recaptcha).toBeLessThan(postInstall);
  });

  it("calls our hooks after react_native_post_install, inside post_install", () => {
    const rnHook = out.indexOf("react_native_post_install(");
    const ours = out.indexOf("ocrecipes_post_install(installer)");
    expect(ours).toBeGreaterThan(rnHook);
    // still inside the post_install block: only the generated-block marker
    // sits between the call and the block's `end` (then the target's `end`)
    expect(out.slice(ours)).toMatch(
      /^ocrecipes_post_install\(installer\)\n {4}# @generated end [^\n]+\n {2}end\nend\n?$/,
    );
  });

  it("is idempotent", () => {
    expect(applyPodfileFixes(out)).toBe(out);
  });

  it("throws when the template no longer has an anchor, instead of skipping the fixes", () => {
    expect(() =>
      applyPodfileFixes(stockPodfile.replace(/post_install do/g, "x")),
    ).toThrow();
  });
});

describe("ocrecipes_post_install.rb", () => {
  const rb = fs.readFileSync(
    path.join(__dirname, "..", "ios", "ocrecipes_post_install.rb"),
    "utf8",
  );

  it("defines the hook the Podfile calls", () => {
    expect(rb).toMatch(/^def ocrecipes_post_install\(installer\)$/m);
  });

  // Each of these only fails at build time (or only in a Release archive), so
  // pin that the hook still carries all of them.
  it.each([
    ["pod deployment-target sweep", "IPHONEOS_DEPLOYMENT_TARGET'] = '16.0'"],
    ["fmt consteval patch (Xcode 26)", "FMT_USE_CONSTEVAL 0"],
    [
      "MLKit simulator EXCLUDED_ARCHS strip",
      "EXCLUDED_ARCHS[sdk=iphonesimulator*]",
    ],
    ["MLKit per-platform run-script phase", "[MLKit] Patch for platform"],
    [
      "VisionCamera Swift 6.2 ICE workaround",
      "SWIFT_OPTIMIZATION_LEVEL'] = '-Onone'",
    ],
  ])("keeps the %s", (_name, needle) => {
    expect(rb).toContain(needle);
  });
});
