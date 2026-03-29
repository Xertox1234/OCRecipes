import React, { useMemo } from "react";
import Svg, { Rect, Text as SvgText } from "react-native-svg";

import { useTheme } from "@/hooks/useTheme";
import { withOpacity } from "@/constants/theme";

interface WeeklyFastingChartProps {
  data: { day: string; minutes: number; completed: boolean }[];
}

function WeeklyChart({ data }: WeeklyFastingChartProps) {
  const { theme } = useTheme();

  const maxMinutes = useMemo(
    () => Math.max(...data.map((d) => d.minutes), 60),
    [data],
  );
  const chartHeight = 120;
  const barWidth = 28;
  const gap = 12;
  const totalWidth = data.length * (barWidth + gap) - gap;
  const padding = { top: 10, bottom: 24 };
  const usableHeight = chartHeight - padding.top - padding.bottom;

  return (
    <Svg
      width="100%"
      height={chartHeight}
      viewBox={`0 0 ${totalWidth} ${chartHeight}`}
    >
      {data.map((d, i) => {
        const barHeight =
          maxMinutes > 0 ? (d.minutes / maxMinutes) * usableHeight : 0;
        const x = i * (barWidth + gap);
        const y = padding.top + usableHeight - barHeight;
        const fillColor = d.completed
          ? theme.success
          : d.minutes > 0
            ? withOpacity(theme.link, 0.6)
            : withOpacity(theme.textSecondary, 0.15);

        return (
          <React.Fragment key={d.day}>
            <Rect
              x={x}
              y={y}
              width={barWidth}
              height={Math.max(barHeight, 2)}
              rx={4}
              fill={fillColor}
            />
            <SvgText
              x={x + barWidth / 2}
              y={chartHeight - 4}
              fontSize={10}
              fill={theme.textSecondary}
              textAnchor="middle"
            >
              {d.day}
            </SvgText>
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

export default React.memo(WeeklyChart);
