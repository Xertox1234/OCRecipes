// Disable iOS autolinking for react-native-vision-camera-barcode-scanner.
// The barcode scanner's nitrogen-generated Swift/C++ interop crashes swift-frontend
// 6.2 (Xcode 26 beta) with an ICE. On iOS we use VisionCamera's built-in
// useObjectOutput (AVFoundation) instead via CameraView.ios.tsx.
// The package remains in node_modules and is auto-linked for Android normally.
module.exports = {
  dependencies: {
    "react-native-vision-camera-barcode-scanner": {
      platforms: {
        ios: null,
      },
    },
  },
};
