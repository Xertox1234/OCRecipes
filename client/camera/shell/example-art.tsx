// Example art for the scan example cards, drawn in house (not taken from any
// reference app) in the theme palette. Decorative: every piece is hidden from
// screen readers — the card's title and body carry the meaning.
import React from "react";
import { View } from "react-native";
import Svg, {
  Defs,
  Line,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import { CameraColors, Colors } from "@/constants/theme";

const INK = Colors.light.text; // warm near-black print
const PAPER = CameraColors.text; // white label stock
const FRAME = CameraColors.border; // the white "aim here" brackets

/** Hides an illustration from VoiceOver and TalkBack. */
function Decorative({ children }: { children: React.ReactNode }) {
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {children}
    </View>
  );
}

// Bar widths for a believable EAN-style pattern (1 = thin, 3 = thick).
const BAR_PATTERN = [
  1, 1, 2, 1, 3, 1, 1, 2, 2, 1, 1, 3, 1, 2, 1, 1, 2, 1, 1, 1, 3, 2, 1, 1, 2, 1,
  3, 1, 1, 2, 1, 1,
];

function barcodeBars(x0: number, y: number, height: number) {
  const unit = 1.6;
  const bars: React.ReactElement[] = [];
  let x = x0;
  BAR_PATTERN.forEach((w, i) => {
    // Every other entry is a gap, so bars and spaces alternate.
    if (i % 2 === 0) {
      bars.push(
        <Rect
          key={i}
          x={x}
          y={y}
          width={w * unit}
          height={height}
          fill={INK}
        />,
      );
    }
    x += w * unit;
  });
  return bars;
}

/** The four white corner brackets of the scan frame, around a w×h box. */
function Brackets({ w, h, len = 20 }: { w: number; h: number; len?: number }) {
  const s = 3; // stroke inset so the 3pt stroke isn't clipped
  const r = 9;
  const d = [
    `M${s} ${s + len} V${s + r} Q${s} ${s} ${s + r} ${s} H${s + len}`,
    `M${w - s - len} ${s} H${w - s - r} Q${w - s} ${s} ${w - s} ${s + r} V${s + len}`,
    `M${s} ${h - s - len} V${h - s - r} Q${s} ${h - s} ${s + r} ${h - s} H${s + len}`,
    `M${w - s - len} ${h - s} H${w - s - r} Q${w - s} ${h - s} ${w - s} ${h - s - r} V${h - s - len}`,
  ].join(" ");
  return (
    <Path
      d={d}
      stroke={FRAME}
      strokeWidth={3}
      fill="none"
      strokeLinecap="round"
    />
  );
}

/** A barcode label lined up inside the wide scan frame. */
export function BarcodeExampleArt() {
  const W = 184;
  const H = 100;
  return (
    <Decorative>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <Brackets w={W} h={H} />
        <Rect x={44} y={22} width={96} height={56} rx={4} fill={PAPER} />
        {barcodeBars(52, 28, 34)}
        <SvgText
          x={92}
          y={73}
          fontSize={8}
          fontWeight="600"
          fill={INK}
          textAnchor="middle"
          letterSpacing={1.2}
        >
          0 12345 67890 5
        </SvgText>
      </Svg>
    </Decorative>
  );
}

// One row of the Nutrition Facts panel: [label, value, bold?, indent?].
type FactRow = [string, string, boolean, boolean];
const FACT_ROWS: FactRow[] = [
  ["Total Fat 8g", "10%", true, false],
  ["Saturated Fat 1g", "5%", false, true],
  ["Sodium 160mg", "7%", true, false],
  ["Total Carb. 37g", "13%", true, false],
  ["Total Sugars 12g", "", false, true],
  ["Protein 5g", "", true, false],
];

/**
 * A readable US-style Nutrition Facts panel (the mockup's 2a art): title,
 * servings, a thick rule, serving size, calories, then the main rows.
 */
export function NutritionLabelExampleArt() {
  const W = 150;
  const pad = 7;
  const right = W - pad;
  const rowH = 11;
  const rowsTop = 82;
  const H = rowsTop + FACT_ROWS.length * rowH + 8;
  return (
    <Decorative>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <Rect x={0} y={0} width={W} height={H} rx={5} fill={PAPER} />
        <SvgText x={pad} y={19} fontSize={16} fontWeight="900" fill={INK}>
          Nutrition Facts
        </SvgText>
        <Line
          x1={pad}
          y1={23}
          x2={right}
          y2={23}
          stroke={INK}
          strokeWidth={1}
        />
        <SvgText x={pad} y={32} fontSize={7} fill={INK}>
          2 servings per container
        </SvgText>
        <SvgText x={pad} y={42} fontSize={7.5} fontWeight="700" fill={INK}>
          Serving size
        </SvgText>
        <SvgText
          x={right}
          y={42}
          fontSize={7.5}
          fontWeight="700"
          fill={INK}
          textAnchor="end"
        >
          3/4 cup (55g)
        </SvgText>
        <Rect x={pad} y={45} width={W - pad * 2} height={4.5} fill={INK} />
        <SvgText x={pad} y={57} fontSize={6} fontWeight="700" fill={INK}>
          Amount per serving
        </SvgText>
        <SvgText x={pad} y={70} fontSize={13} fontWeight="900" fill={INK}>
          Calories
        </SvgText>
        <SvgText
          x={right}
          y={71}
          fontSize={16}
          fontWeight="900"
          fill={INK}
          textAnchor="end"
        >
          230
        </SvgText>
        <Rect x={pad} y={74} width={W - pad * 2} height={2.5} fill={INK} />
        {FACT_ROWS.map(([label, value, bold, indent], i) => {
          const y = rowsTop + i * rowH;
          const last = i === FACT_ROWS.length - 1;
          return (
            <React.Fragment key={label}>
              <SvgText
                x={indent ? pad + 6 : pad}
                y={y + 2}
                fontSize={7.5}
                fontWeight={bold ? "700" : "400"}
                fill={INK}
              >
                {label}
              </SvgText>
              {value ? (
                <SvgText
                  x={right}
                  y={y + 2}
                  fontSize={7.5}
                  fontWeight="700"
                  fill={INK}
                  textAnchor="end"
                >
                  {value}
                </SvgText>
              ) : null}
              <Rect
                x={pad}
                y={y + 4.5}
                width={W - pad * 2}
                height={last ? 3 : 0.5}
                fill={INK}
              />
            </React.Fragment>
          );
        })}
      </Svg>
    </Decorative>
  );
}

/** A made-up granola box front: name, product line, a bowl, net weight. */
export function PackageFrontExampleArt() {
  const W = 104;
  const H = 136;
  const ink = CameraColors.exampleArtPackageInk;
  return (
    <Decorative>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <Defs>
          <LinearGradient id="pkg" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={CameraColors.exampleArtPackage} />
            <Stop offset="1" stopColor={CameraColors.exampleArtPackageShade} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={W} height={H} rx={7} fill="url(#pkg)" />
        <SvgText
          x={W / 2}
          y={24}
          fontSize={12}
          fontWeight="800"
          fill={ink}
          textAnchor="middle"
        >
          OAT CRUNCH
        </SvgText>
        <SvgText
          x={W / 2}
          y={36}
          fontSize={7.5}
          fontWeight="500"
          fill={ink}
          textAnchor="middle"
        >
          Toasted granola
        </SvgText>
        {/* Bowl of granola: a cream half-bowl with a heaped top. */}
        <Path
          d={`M22 64 Q52 54 82 64 Z`}
          fill={CameraColors.exampleArtPackageShade}
        />
        <Path
          d={`M20 64 H84 Q84 96 52 96 Q20 96 20 64 Z`}
          fill={CameraColors.exampleArtBowl}
        />
        <SvgText
          x={W / 2}
          y={122}
          fontSize={7.5}
          fontWeight="600"
          fill={ink}
          textAnchor="middle"
        >
          NET WT 450 g
        </SvgText>
      </Svg>
    </Decorative>
  );
}
