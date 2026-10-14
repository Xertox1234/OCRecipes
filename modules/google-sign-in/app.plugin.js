const { withInfoPlist } = require("expo/config-plugins");

/**
 * Registers the reversed iOS client ID as a URL scheme — Google's iOS SDK
 * closes the app if it is missing. Appends to CFBundleURLTypes rather than
 * setting `ios.infoPlist.CFBundleURLTypes` in app.json, which would replace
 * the app's own `scheme` entries (ocrecipes://, the bundle ID).
 */
function addUrlScheme(infoPlist, scheme) {
  const types = infoPlist.CFBundleURLTypes ?? [];
  const present = types.some((t) => t.CFBundleURLSchemes?.includes(scheme));
  return {
    ...infoPlist,
    CFBundleURLTypes: present
      ? types
      : [...types, { CFBundleURLSchemes: [scheme] }],
  };
}

function withGoogleSignIn(config, { iosUrlScheme } = {}) {
  if (!iosUrlScheme) {
    throw new Error(
      "modules/google-sign-in plugin: the iosUrlScheme option (the reversed iOS client ID) is required",
    );
  }
  return withInfoPlist(config, (mod) => {
    mod.modResults = addUrlScheme(mod.modResults, iosUrlScheme);
    return mod;
  });
}

module.exports = withGoogleSignIn;
module.exports.addUrlScheme = addUrlScheme;
