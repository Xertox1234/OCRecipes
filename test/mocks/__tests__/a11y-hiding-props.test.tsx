// @vitest-environment jsdom
/**
 * Contract test for how the shared mocks treat RN's accessibility-HIDING pair —
 * `accessibilityElementsHidden` (iOS) and `importantForAccessibility=
 * "no-hide-descendants"` (Android) — on the two component families that used
 * to miss it:
 *
 *   - Animated.View / Animated.Text   (test/mocks/react-native-reanimated.ts,
 *     `mapA11yProps`)
 *   - FlatList / SectionList          (test/mocks/react-native.ts,
 *     `createFlatListMock` + the hand-written SectionList; BottomSheetFlatList
 *     is built by the same `createFlatListMock`)
 *
 * Before, reanimated's `mapA11yProps` let both props fall through raw onto the
 * DOM node (the string one as a lowercased `importantforaccessibility`
 * attribute plus a React unknown-prop warning), and the list mocks destructure
 * a fixed prop list and silently dropped them. Either way, hiding on those
 * components could not be asserted. Both now route through `ariaHiddenProps`
 * (the helper `mockComponent`, `Pressable` and the icon mock already use), so
 * a `*ByRole` query excludes the hidden subtree. See docs/solutions/
 * conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md.
 *
 * Scope limit from that doc: `ariaHiddenProps` ORs the pair, so a passing
 * `aria-hidden` read-back proves AT LEAST ONE hiding prop is set — never which
 * platform is covered. The single-prop rows below pin that EACH prop is wired
 * into the mock, not that a production component sets the right one.
 *
 * Every hidden-case is paired with a not-hidden case on the same selector
 * (rule 1a of that doc): a role count of 0 alone cannot tell "hidden" from
 * "the selector matches nothing".
 */
import React from "react";
import { screen } from "@testing-library/react";
import { FlatList, Pressable, SectionList } from "react-native";
import Animated from "react-native-reanimated";
import { BottomSheetFlatList } from "@gorhom/bottom-sheet";
import { renderComponent } from "../../utils/render-component";

type HidingProps = {
  accessibilityElementsHidden?: boolean;
  importantForAccessibility?: "auto" | "yes" | "no" | "no-hide-descendants";
};

// One accessible child per subject, so "hidden" is observable as that child
// leaving the accessibility tree. Asserted as a role COUNT: a name filter can
// never match a node the fix itself removed, which would make the check vacuous.
const CHILD = (
  <Pressable accessibilityRole="button" accessibilityLabel="Child action" />
);
const rows = [{ id: "row-1" }];
const keyExtractor = (row: { id: string }) => row.id;
const renderRow = () => CHILD;

interface Subject {
  name: string;
  render: (hiding: HidingProps) => void;
}

const ANIMATED: Subject[] = [
  {
    name: "Animated.View",
    render: (hiding) =>
      renderComponent(
        <Animated.View testID="subject" {...hiding}>
          {CHILD}
        </Animated.View>,
      ),
  },
  {
    name: "Animated.Text",
    render: (hiding) =>
      renderComponent(
        <Animated.Text testID="subject" {...hiding}>
          {CHILD}
        </Animated.Text>,
      ),
  },
];

const LISTS: Subject[] = [
  {
    name: "FlatList",
    render: (hiding) =>
      renderComponent(
        <FlatList
          testID="subject"
          data={rows}
          keyExtractor={keyExtractor}
          renderItem={renderRow}
          {...hiding}
        />,
      ),
  },
  {
    name: "SectionList",
    render: (hiding) =>
      renderComponent(
        <SectionList
          testID="subject"
          sections={[{ title: "Section", data: rows }]}
          keyExtractor={keyExtractor}
          renderItem={renderRow}
          {...hiding}
        />,
      ),
  },
  {
    // Built by the same createFlatListMock as FlatList, so it inherits the fix.
    name: "BottomSheetFlatList",
    render: (hiding) =>
      renderComponent(
        <BottomSheetFlatList
          testID="subject"
          data={rows}
          keyExtractor={keyExtractor}
          renderItem={renderRow}
          {...hiding}
        />,
      ),
  },
];

const HIDDEN: [label: string, hiding: HidingProps][] = [
  ["accessibilityElementsHidden alone", { accessibilityElementsHidden: true }],
  [
    'importantForAccessibility="no-hide-descendants" alone',
    { importantForAccessibility: "no-hide-descendants" },
  ],
  [
    "both props together",
    {
      accessibilityElementsHidden: true,
      importantForAccessibility: "no-hide-descendants",
    },
  ],
];

const NOT_HIDDEN: [label: string, hiding: HidingProps][] = [
  ["no hiding props", {}],
  // What useConfirmationModal()'s behindContentA11yProps emits while its sheet
  // is CLOSED. An un-hide that failed to un-hide would lock a screen reader
  // out of the screen it just finished covering.
  [
    "the closed pair (accessibilityElementsHidden=false, importantForAccessibility=auto)",
    { accessibilityElementsHidden: false, importantForAccessibility: "auto" },
  ],
  // "no" excludes only the view itself, never its subtree, so ariaHiddenProps
  // deliberately never maps it (TextInput's Animated.Text relies on that).
  ['importantForAccessibility="no"', { importantForAccessibility: "no" }],
];

describe.each([...ANIMATED, ...LISTS])("$name", ({ render }) => {
  it.each(HIDDEN)("hides its subtree: %s", (_label, hiding) => {
    render(hiding);

    expect(screen.getByTestId("subject").getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it.each(NOT_HIDDEN)("keeps its subtree reachable: %s", (_label, hiding) => {
    render(hiding);

    expect(screen.getByTestId("subject").hasAttribute("aria-hidden")).toBe(
      false,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});

// Only meaningful for the reanimated family: its old `...domSafe` passthrough
// is what let `importantForAccessibility` reach the node raw. The list mocks
// never leaked it (they dropped it), so this read-back would be vacuously true
// for them before and after.
describe.each(ANIMATED)(
  "$name — no raw hiding attribute on the DOM node",
  ({ render }) => {
    it.each(["no-hide-descendants", "auto", "no"] as const)(
      "importantForAccessibility=%s is consumed, not passed through",
      (importantForAccessibility) => {
        render({ importantForAccessibility });

        expect(
          screen
            .getByTestId("subject")
            .hasAttribute("importantforaccessibility"),
        ).toBe(false);
      },
    );
  },
);

// CollapsibleSection's clip container sets a literal `aria-hidden` beside
// `importantForAccessibility`, in lockstep. The translated value is spread
// AFTER the literal one (as every other mapped attribute in `mapA11yProps`
// is), so when the pair says "hidden" it wins over a literal
// `aria-hidden={false}`, and a literal that agrees with the pair simply passes
// through. The rows below also cover both props set, a superset of that case.
describe("Animated.View — a literal aria-hidden next to the pair", () => {
  type LiteralProps = HidingProps & { "aria-hidden"?: boolean };
  const LITERAL_CASES: [
    label: string,
    props: LiteralProps,
    expected: string,
  ][] = [
    [
      "expanded: literal false + closed pair",
      {
        "aria-hidden": false,
        accessibilityElementsHidden: false,
        importantForAccessibility: "auto",
      },
      "false",
    ],
    [
      "collapsed: literal true + hiding pair",
      {
        "aria-hidden": true,
        accessibilityElementsHidden: true,
        importantForAccessibility: "no-hide-descendants",
      },
      "true",
    ],
    [
      "literal true, pair unset: literal passes through",
      { "aria-hidden": true },
      "true",
    ],
    [
      "literal false but the pair says hidden: hidden wins",
      {
        "aria-hidden": false,
        importantForAccessibility: "no-hide-descendants",
      },
      "true",
    ],
  ];

  it.each(LITERAL_CASES)("%s", (_label, props, expected) => {
    renderComponent(<Animated.View testID="subject" {...props} />);

    expect(screen.getByTestId("subject").getAttribute("aria-hidden")).toBe(
      expected,
    );
  });
});

// `accessibilityViewIsModal` → `aria-modal`, via the shared `ariaModalProps`
// helper `mockComponent` already uses. Reanimated only: ProductChip's overlay
// is the one production Animated.View that sets it, and the old `...domSafe`
// passthrough let it reach the div raw (a React unknown-prop warning, never
// assertable). Paired with an unset case, per rule 1a above.
describe("Animated.View — accessibilityViewIsModal", () => {
  it("maps accessibilityViewIsModal to aria-modal", () => {
    renderComponent(
      <Animated.View testID="subject" accessibilityViewIsModal />,
    );

    expect(screen.getByTestId("subject").getAttribute("aria-modal")).toBe(
      "true",
    );
  });

  it("sets no aria-modal when the prop is unset", () => {
    renderComponent(<Animated.View testID="subject" />);

    expect(screen.getByTestId("subject").hasAttribute("aria-modal")).toBe(
      false,
    );
  });
});
