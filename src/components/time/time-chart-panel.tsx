"use client";

/**
 * Rutan Stapeldiagram (#2110): en persons registrerade tid som staplar för en
 * dag, vecka, månad eller ett år. Knapparna Dag / Vecka / Månad / År väljer
 * perioden, och staplarna är nivån under. Ett klick på en stapel visar dess
 * summor och ärendena med tid där. Pilarna runt knapparna stegar den valda
 * dagen en stapel i taget, och vyn är personens egen (`chart.time`, #2111).
 * Frågan `timeEntry.chart` körs mot den
 * lokala storen (ADR 0016), så rutan fungerar offline.
 */

import { useState } from "react";
import { BarChart } from "@/components/ui/bar-chart";
import { DayStepper } from "@/components/ui/day-stepper";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { EntityLink } from "@/lib/client/demo/entity-link";
import { trpc } from "@/lib/client/trpc";
import { periodContaining } from "@/lib/shared/calendar-periods";
import { formatDecimalHoursWithUnit } from "@/lib/shared/kr-format";
import type { UserId } from "@/lib/shared/schemas/ids";
import type { TimeChart, TimeChartBar, TimeChartGranularity } from "@/lib/shared/time-chart";
import {
  TIME_CHART_GRANULARITY, TIME_CHART_STEP, TIME_CHART_VIEW_OPTIONS, timeChartBarAriaLabel,
  timeChartBarPeriod, timeChartPeriodTitle,
} from "./time-chart-labels";
import { useTimeChartView } from "./use-time-chart-view";

/** Props för {@link TimeChartPanel}. */
export interface TimeChartPanelProps {
  /** Personen vars tid diagrammet visar. */
  userId: UserId;
  /** Dagen rutan utgår från ("YYYY-MM-DD"); ett nytt värde flyttar den valda dagen dit. */
  anchorDay: string;
}

/** "Totalt 12,5 h · Debiterbart 10 h". */
function totalsText(t: { totalMinutes: number; billableMinutes: number }): string {
  return `Totalt ${formatDecimalHoursWithUnit(t.totalMinutes)} · Debiterbart ${formatDecimalHoursWithUnit(t.billableMinutes)}`;
}

/** Den valda dagen: följer `anchorDay` när den ändras (state under render, inte en effekt). */
function useSelectedDay(anchorDay: string): [string, (day: string) => void] {
  const [selected, setSelected] = useState(anchorDay);
  const [anchor, setAnchor] = useState(anchorDay);
  if (anchor !== anchorDay) {
    setAnchor(anchorDay);
    setSelected(anchorDay);
  }
  return [selected, setSelected];
}

/** Den valda stapelns period, summor och ärenden. */
function BarDetails({ bar }: { bar: TimeChartBar }) {
  return (
    <div className="mt-3 text-sm">
      <p className="text-gray-700">
        <span className="font-medium">{timeChartBarPeriod(bar)}</span> · {totalsText(bar)}
      </p>
      <ul className="mt-1 space-y-0.5">
        {bar.matters.map((m) => (
          <li key={m.id}>
            <EntityLink route="matters" id={m.id} className="text-blue-600 hover:underline">
              {m.matterNumber} — {m.title}
            </EntityLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface ChartBodyProps {
  chart: TimeChart;
  granularity: TimeChartGranularity;
  selectedDay: string;
  onSelect: (day: string) => void;
}

/** Diagrammet och den valda stapeln, eller texten för en tom period. */
function ChartBody({ chart, granularity, selectedDay, onSelect }: ChartBodyProps) {
  if (chart.totalMinutes === 0) return <p className="text-sm text-gray-500">Ingen tid registrerad.</p>;
  const selected = chart.bars.find((b) => b.from <= selectedDay && selectedDay <= b.to);
  const bars = chart.bars.map((b) => ({
    key: b.key, label: b.label, value: b.totalMinutes, ariaLabel: timeChartBarAriaLabel(b, granularity),
  }));
  return (
    <>
      <BarChart bars={bars} selectedKey={selected?.key ?? null} onSelect={onSelect} />
      {selected && <BarDetails bar={selected} />}
    </>
  );
}

/** Stapeldiagrammet över `userId`:s tid, med vyval och den valda stapelns ärenden. */
export function TimeChartPanel({ userId, anchorDay }: TimeChartPanelProps) {
  const [view, setView] = useTimeChartView();
  const [selectedDay, setSelectedDay] = useSelectedDay(anchorDay);
  const period = periodContaining(selectedDay, view);
  const granularity = TIME_CHART_GRANULARITY[view];
  const chart = trpc.timeEntry.chart.useQuery({ userId, from: period.from, to: period.to, granularity });
  const title = timeChartPeriodTitle(view, selectedDay, new Date());

  return (
    <div className="p-2">
      <DayStepper ymd={selectedDay} onChange={setSelectedDay} unit={TIME_CHART_STEP[view]}>
        <SegmentedControl options={TIME_CHART_VIEW_OPTIONS} value={view} onChange={setView} ariaLabel="Period" />
      </DayStepper>
      <h2 className="mt-2 mb-2 font-semibold text-gray-900">
        {chart.data ? `${title} · ${totalsText(chart.data)}` : title}
      </h2>
      {chart.data
        ? <ChartBody chart={chart.data} granularity={granularity} selectedDay={selectedDay} onSelect={setSelectedDay} />
        : <p className="text-sm text-gray-500">Laddar...</p>}
    </div>
  );
}
