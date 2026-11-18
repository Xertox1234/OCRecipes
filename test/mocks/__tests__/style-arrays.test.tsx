// @vitest-environment jsdom
/**
 * Contract test: the shared mocks accept React Native's `style` shapes.
 *
 * RN allows `style` to be an object, a (nested) array of objects, or falsy
 * entries inside an array (`[base, pressed && styles.pressed]`). A DOM element
 * only takes one plain object. Passed an array, react-dom runs
 * `element.style[0] = {...}`: jsdom 28 ignored that silently (so the styles
 * were never applied), and jsdom 31 throws `'set' on proxy: trap returned
 * falsish for property '0'`, which fails the whole render.
 *
 * Each row renders one mock with a nested array and reads one style back from
 * the DOM node, so it proves both "does not throw" and "the array was merged".
 */
import React from "react";
import { screen } from "@testing-library/react";
import {
  ActivityIndicator,
  Image,
  type ImageStyle,
  Modal,
  ScrollView,
  type StyleProp,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type ViewStyle,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { BottomSheetView } from "@gorhom/bottom-sheet";
import Animated from "react-native-reanimated";
import { renderComponent } from "../../utils/render-component";
import { flattenStyle } from "../react-native";

const nested: StyleProp<ViewStyle> = [
  { opacity: 0.5 },
  false,
  null,
  undefined,
  [{ flexGrow: 1 }, [{ opacity: 0.25 }]],
];

describe("flattenStyle", () => {
  it("merges nested arrays left to right and skips falsy entries", () => {
    expect(flattenStyle(nested)).toEqual({ opacity: 0.25, flexGrow: 1 });
  });

  it("returns a plain object unchanged", () => {
    const style = { opacity: 1 };
    expect(flattenStyle(style)).toBe(style);
  });

  it("returns undefined for a missing or falsy style", () => {
    expect(flattenStyle(undefined)).toBeUndefined();
    expect(flattenStyle(null)).toBeUndefined();
    expect(flattenStyle(false)).toBeUndefined();
  });
});

describe("mocks render an RN style array", () => {
  const rows: [string, (style: StyleProp<ViewStyle>) => React.ReactElement][] =
    [
      ["View", (style) => <View testID="node" style={style} />],
      ["Text", (style) => <Text testID="node" style={style} />],
      ["ScrollView", (style) => <ScrollView testID="node" style={style} />],
      [
        "Image",
        (style) => (
          <Image testID="node" style={style as StyleProp<ImageStyle>} />
        ),
      ],
      ["TextInput", (style) => <TextInput testID="node" style={style} />],
      [
        "TouchableOpacity",
        (style) => <TouchableOpacity testID="node" style={style} />,
      ],
      ["Switch", (style) => <Switch testID="node" style={style} />],
      [
        "ActivityIndicator",
        (style) => <ActivityIndicator testID="node" style={style} />,
      ],
      ["Modal", (style) => <Modal testID="node" style={style} />],
      [
        "expo-image Image",
        (style) => (
          <ExpoImage testID="node" style={style as StyleProp<ImageStyle>} />
        ),
      ],
      [
        "LinearGradient",
        (style) => (
          <LinearGradient
            colors={["#000", "#fff"]}
            data-testid="node"
            style={style}
          />
        ),
      ],
      [
        "BottomSheetView",
        (style) => (
          <BottomSheetView testID="node" style={style}>
            {null}
          </BottomSheetView>
        ),
      ],
      [
        "Animated.View",
        (style) => <Animated.View testID="node" style={style} />,
      ],
      [
        "Animated.Text",
        (style) => <Animated.Text testID="node" style={style} />,
      ],
    ];

  it.each(rows)("%s applies the merged style", (_name, build) => {
    renderComponent(build(nested));
    const node = screen.getByTestId("node");
    expect(node.style.opacity).toBe("0.25");
    expect(node.style.flexGrow).toBe("1");
  });
});
