// Mock @react-navigation/elements for component render tests.
// The real package ships a .png asset (header back-icon) that Vite's SSR
// module runner can fail to transform at large test-suite scale, throwing
// "Unknown file extension .png" from Node's raw ESM loader. Matches the
// value already used by client/hooks/__tests__/useHeaderContentInset.test.ts's
// local vi.mock for the same export.
export const useHeaderHeight = () => 88;
