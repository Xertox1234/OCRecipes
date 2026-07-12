// Mock react-native-svg for component render tests.
//
// The real package transitively imports the real `react-native` package's
// deep Flow-syntax files (e.g. `react-native/Libraries/Utilities/
// codegenNativeComponent`, `react-native/index.js`'s `import typeof * as
// ReactNativePublicAPI from './index.js.flow'`) — neither oxc nor esbuild
// can parse Flow, so any component that imports react-native-svg fails at
// transform time with a misleading "Unexpected token 'typeof'" unless this
// module is intercepted before Vite ever reaches the real package. No test
// exercised react-native-svg before CalorieRing.tsx's render test (the
// first screen-level test to render it), so this alias didn't previously
// exist.
//
// Renders simple SVG DOM equivalents so jsdom-based render assertions work
// (mirrors the mockComponent pattern in test/mocks/react-native.ts).
import React from "react";

function svgEl(tag: string, displayName: string) {
  const Comp = React.forwardRef<unknown, Record<string, unknown>>(
    ({ children, ...rest }, ref) =>
      React.createElement(tag, { ref, ...rest }, children as React.ReactNode),
  );
  Comp.displayName = displayName;
  return Comp;
}

export const Circle = svgEl("circle", "Circle");
export const Rect = svgEl("rect", "Rect");
export const Path = svgEl("path", "Path");
export const G = svgEl("g", "G");
export const Defs = svgEl("defs", "Defs");
export const LinearGradient = svgEl("linearGradient", "LinearGradient");
export const RadialGradient = svgEl("radialGradient", "RadialGradient");
export const Stop = svgEl("stop", "Stop");
export const Line = svgEl("line", "Line");
export const Polygon = svgEl("polygon", "Polygon");
export const Polyline = svgEl("polyline", "Polyline");
export const Ellipse = svgEl("ellipse", "Ellipse");

const Svg = svgEl("svg", "Svg");
export default Svg;
