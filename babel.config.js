module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      [
        "module-resolver",
        {
          // No `root`: nothing imports by a project-root path, and the option
          // makes the plugin call `glob.default`, which glob 14 does not export
          // (package.json overrides put every glob at 14). With it set, Metro
          // fails on every file.
          // Guard: scripts/ci/__tests__/babel-config-transforms.test.ts
          alias: {
            "@": "./client",
            "@shared": "./shared",
          },
          extensions: [".ios.js", ".android.js", ".js", ".ts", ".tsx", ".json"],
        },
      ],
      "react-native-reanimated/plugin",
    ],
  };
};
