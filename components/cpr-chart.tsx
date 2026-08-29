"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { classificationLabel } from "@/lib/cpr/classification";
import {
  chartColors,
  chartColorsDark,
  classificationColors,
  classificationColorsDark,
  colorForClassification,
} from "@/lib/theme/tokens";
import type { MaybeRedactedRecord } from "@/lib/cpr/redact";
import { formatShortDate } from "@/lib/utils/date";
import { formatCompact, formatPercent, formatPrice } from "@/lib/utils/format";

/**
 * CPR width / width % over time (PRD §15).
 *
 * ── Design decisions ───────────────────────────────────────────────────────
 * • Two SEPARATE charts, never one with two y-axes. Width (points) and width %
 *   are different measures on wildly different scales; overlaying them on twin
 *   axes lets the reader infer crossings that carry no meaning.
 * • Bars, not a line: each session is a discrete magnitude, and bars give each
 *   one its own fill so classification can be encoded per session.
 * • Colour is never the sole carrier — the legend is always present, and the
 *   tooltip names the classification in text.
 */

interface ChartRow {
  date: string;
  label: string;
  width: number;
  widthPercent: number;
  classification: string;
  projected: boolean;
}

function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setIsDark(root.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

function ChartTooltip({
  active,
  payload,
  metric,
  isDark,
}: {
  active?: boolean;
  payload?: { payload: ChartRow }[];
  metric: "width" | "widthPercent";
  isDark: boolean;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const palette = isDark ? chartColorsDark : chartColors;

  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-lg"
      style={{
        background: palette.tooltipBg,
        borderColor: palette.tooltipBorder,
        color: palette.tooltipText,
      }}
    >
      <div className="font-semibold">{row.label}</div>
      <div className="numeric mt-1">
        {metric === "width"
          ? `${formatPrice(row.width)} points`
          : formatPercent(row.widthPercent)}
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <span
          aria-hidden
          className="inline-block h-2 w-2 rounded-full"
          style={{
            background: colorForClassification(row.classification, isDark),
          }}
        />
        <span>{classificationLabel(row.classification as never)}</span>
      </div>
      {row.projected ? (
        <div className="mt-1 opacity-70">Projected next session</div>
      ) : null}
    </div>
  );
}

function Legend({ isDark }: { isDark: boolean }) {
  const palette = isDark ? classificationColorsDark : classificationColors;
  const entries: [string, string][] = [
    ["NARROW", palette.NARROW],
    ["MIXED", palette.MIXED],
    ["WIDER", palette.WIDER],
    ["CONFLICTING", palette.CONFLICTING],
    ["UNCLASSIFIED", palette.UNCLASSIFIED],
  ];
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 pb-1">
      {entries.map(([key, color]) => (
        <li key={key} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: color }}
          />
          <span className="text-xs text-ink-muted">
            {classificationLabel(key as never)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CPRChart({
  records,
  metric,
  height = 260,
}: {
  records: MaybeRedactedRecord[];
  metric: "width" | "widthPercent";
  height?: number;
}) {
  const isDark = useIsDark();
  const palette = isDark ? chartColorsDark : chartColors;

  if (records.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-ink-muted">
        No CPR data available for this range.
      </p>
    );
  }

  // Oldest -> newest reads left to right on a time axis.
  const rows: ChartRow[] = [...records]
    .sort((a, b) => a.tradingDate.localeCompare(b.tradingDate))
    .map((r) => ({
      date: r.tradingDate,
      label: formatShortDate(r.tradingDate),
      width: r.cprWidth,
      widthPercent: r.cprWidthPercent,
      classification: r.overallClassification,
      projected: r.projected,
    }));

  const dataKey = metric === "width" ? "width" : "widthPercent";

  return (
    <div>
      <Legend isDark={isDark} />
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            margin={{ top: 8, right: 8, bottom: 4, left: 4 }}
            barCategoryGap="18%"
          >
            <CartesianGrid
              stroke={palette.grid}
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{ fill: palette.axis, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: palette.grid }}
              minTickGap={16}
            />
            <YAxis
              tick={{ fill: palette.axis, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={(value: number) =>
                metric === "width"
                  ? formatCompact(value)
                  : `${formatCompact(value)}%`
              }
            />
            <Tooltip
              cursor={{ fill: palette.grid, fillOpacity: 0.35 }}
              content={
                <ChartTooltip metric={metric} isDark={isDark} />
              }
            />
            <Bar dataKey={dataKey} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {rows.map((row) => (
                <Cell
                  key={row.date}
                  fill={colorForClassification(row.classification, isDark)}
                  // The projected session is drawn hollow so a forecast is never
                  // mistaken for a settled one.
                  fillOpacity={row.projected ? 0.4 : 1}
                  stroke={colorForClassification(row.classification, isDark)}
                  strokeWidth={row.projected ? 1.5 : 0}
                  strokeDasharray={row.projected ? "3 2" : undefined}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
