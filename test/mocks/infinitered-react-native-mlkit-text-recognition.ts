import { vi } from "vitest";

/**
 * Global mock for @infinitered/react-native-mlkit-text-recognition.
 *
 * Registered as a resolve.alias in vitest.config.ts so that any test-suite file
 * reaching the @/camera barrel (ScanScreen, ReceiptCaptureScreen,
 * CookSessionCaptureScreen) does not pull the real package into the module
 * graph. It is an Expo Modules API package, so importing it drags in the
 * expo-modules-core runtime — and Vitest cannot type-strip the raw TypeScript
 * that ships inside node_modules (expo/src/Expo.ts), which fails the whole
 * suite at collection time before a single test runs.
 *
 * The predecessor (@react-native-ml-kit/text-recognition) never needed this: it
 * read NativeModules lazily and resolved to a Proxy that only threw on access.
 *
 * Resolves to a benign empty result rather than undefined, so a transitive
 * caller that does reach OCR gets `{ text: "" }` instead of a TypeError on
 * `.text`.
 *
 * Tests that need to drive OCR behaviour (recognizeTextFromPhoto.test.ts)
 * override this locally via
 * `vi.mock("@infinitered/react-native-mlkit-text-recognition")`.
 */
export const recognizeText = vi.fn((_imagePath: string) =>
  Promise.resolve({ text: "", blocks: [] }),
);
