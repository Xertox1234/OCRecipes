const { withPodfile } = require("expo/config-plugins");
const {
  mergeContents,
} = require("@expo/config-plugins/build/utils/generateCode");

/**
 * Carries our hand-made Podfile changes through `expo prebuild` (CNG):
 *
 * - the GoogleUtilities / RecaptchaInterop modular-header pods that
 *   GoogleSignIn 10 (modules/google-sign-in) needs, and
 * - a call to `ocrecipes_post_install` (plugins/ios/ocrecipes_post_install.rb),
 *   which holds the Xcode 26 build fixes as real Ruby rather than as strings.
 *
 * Every insertion is tagged (idempotent) and throws if its anchor is missing,
 * so a template change fails the prebuild instead of silently dropping a fix
 * that would otherwise only surface on EAS or in a Release archive.
 */
function applyPodfileFixes(src) {
  let out = mergeContents({
    tag: "ocrecipes-podfile-hooks-require",
    src,
    newSrc: "require_relative '../plugins/ios/ocrecipes_post_install'",
    anchor: /^require 'json'$/,
    offset: 1,
    comment: "#",
  }).contents;

  out = mergeContents({
    tag: "ocrecipes-google-sign-in-modular-headers",
    src: out,
    newSrc: [
      "  # GoogleSignIn 10 (modules/google-sign-in) pulls in AppCheckCore, a Swift pod",
      "  # that imports these two; as static libraries they need module maps.",
      "  pod 'GoogleUtilities', :modular_headers => true",
      "  pod 'RecaptchaInterop', :modular_headers => true",
    ].join("\n"),
    anchor: /^ {2}post_install do \|installer\|$/,
    offset: 0,
    comment: "  #",
  }).contents;

  // mergeContents matches one line at a time (first hit wins). The first
  // 4-space-indented `)` is react_native_post_install's closing paren —
  // use_react_native!( closes at 2 spaces. The test pins the placement.
  out = mergeContents({
    tag: "ocrecipes-post-install-call",
    src: out,
    newSrc: "    ocrecipes_post_install(installer)",
    anchor: /^ {4}\)$/,
    offset: 1,
    comment: "    #",
  }).contents;

  return out;
}

function withIosPodfileFixes(config) {
  return withPodfile(config, (mod) => {
    mod.modResults.contents = applyPodfileFixes(mod.modResults.contents);
    return mod;
  });
}

module.exports = withIosPodfileFixes;
module.exports.applyPodfileFixes = applyPodfileFixes;
