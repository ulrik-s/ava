/**
 * Stapeldiagrammet över tid (#2109): indelning per dag, vecka och månad,
 * summor, debiterbar tid, ärendena per stapel och den svenska kalenderdagen.
 */

import { describe, expect, it } from "vitest-compat";
import { buildTimeChart, timeChartLabel, type TimeChartEntry, type TimeChartMatter } from "@/lib/shared/time-chart";

const m = (id: string, matterNumber: string): TimeChartMatter => ({ id, matterNumber, title: `Ärende ${id}` });
const entry = (date: string, minutes: number, matter: TimeChartMatter | null, billable = true): TimeChartEntry =>
  ({ date: new Date(date), minutes, billable, matter });

describe("buildTimeChart — staplarna", () => {
  it("tomma staplar finns med, i tidsordning", () => {
    const chart = buildTimeChart({
      entries: [entry("2026-11-25T10:00:00Z", 60, m("a", "2026-0001"))],
      from: "2026-11-23", to: "2026-11-26", granularity: "day",
    });
    expect(chart.bars.map((b) => [b.key, b.totalMinutes])).toEqual([
      ["2026-11-23", 0], ["2026-11-24", 0], ["2026-11-25", 60], ["2026-11-26", 0],
    ]);
    expect(chart.bars[0]?.matters).toEqual([]);
  });

  it("en vecka som delas av två månader räknar bara dagarna i intervallet", () => {
    // v. 49 2026 är 30/11–6/12; intervallet slutar 30/11.
    const chart = buildTimeChart({
      entries: [entry("2026-11-30T10:00:00Z", 30, null), entry("2026-12-01T10:00:00Z", 45, null)],
      from: "2026-11-01", to: "2026-11-30", granularity: "week",
    });
    const last = chart.bars.at(-1);
    expect(last).toMatchObject({ key: "2026-11-30", from: "2026-11-30", to: "2026-11-30", totalMinutes: 30 });
    expect(chart.totalMinutes).toBe(30);
  });

  it("staplarnas summor är totalen, och debiterbar tid räknas bara på billable", () => {
    const chart = buildTimeChart({
      entries: [
        entry("2026-01-10T10:00:00Z", 60, m("a", "1"), true),
        entry("2026-02-10T10:00:00Z", 30, m("a", "1"), false),
        entry("2026-02-11T10:00:00Z", 90, m("b", "2"), true),
      ],
      from: "2026-01-01", to: "2026-03-31", granularity: "month",
    });
    expect(chart.bars.map((b) => [b.totalMinutes, b.billableMinutes])).toEqual([[60, 60], [120, 90], [0, 0]]);
    expect(chart.totalMinutes).toBe(chart.bars.reduce((s, b) => s + b.totalMinutes, 0));
    expect(chart).toMatchObject({ totalMinutes: 180, billableMinutes: 150 });
  });

  it("ärendena per stapel är unika, sorterade på ärendenummer och bara de med tid i stapeln", () => {
    const a = m("a", "2026-0002");
    const b = m("b", "2026-0001");
    const c = m("c", "2026-0003");
    const chart = buildTimeChart({
      entries: [
        entry("2026-11-24T08:00:00Z", 10, a), entry("2026-11-24T09:00:00Z", 10, b),
        entry("2026-11-24T10:00:00Z", 10, a), entry("2026-11-24T11:00:00Z", 15, null),
        entry("2026-11-25T10:00:00Z", 10, c),
      ],
      from: "2026-11-24", to: "2026-11-25", granularity: "day",
    });
    expect(chart.bars[0]?.matters).toEqual([b, a]);
    expect(chart.bars[0]?.totalMinutes).toBe(45);
    expect(chart.bars[1]?.matters).toEqual([c]);
  });

  it("en post räknas på sin svenska kalenderdag", () => {
    const chart = buildTimeChart({
      entries: [{ date: "2026-11-23T23:30:00Z", minutes: 60, billable: true, matter: null }],
      from: "2026-11-23", to: "2026-11-24", granularity: "day",
    });
    expect(chart.bars.map((b) => b.totalMinutes)).toEqual([0, 60]);
  });

  it("en post utanför intervallet räknas inte", () => {
    const chart = buildTimeChart({
      entries: [entry("2026-12-05T10:00:00Z", 60, null)],
      from: "2026-11-23", to: "2026-11-24", granularity: "day",
    });
    expect(chart.totalMinutes).toBe(0);
  });
});

describe("timeChartLabel", () => {
  it("dag, vecka och månad", () => {
    expect(timeChartLabel("2026-11-24", "day")).toBe("tis 24/11");
    expect(timeChartLabel("2026-11-23", "day")).toBe("mån 23/11");
    expect(timeChartLabel("2026-11-29", "day")).toBe("sön 29/11");
    expect(timeChartLabel("2026-11-23", "week")).toBe("v. 48");
    expect(timeChartLabel("2026-11-01", "month")).toBe("nov");
    expect(timeChartLabel("2026-05-01", "month")).toBe("maj");
  });

  it("staplarna bär etiketten för sin första dag", () => {
    const chart = buildTimeChart({ entries: [], from: "2026-11-23", to: "2026-12-06", granularity: "week" });
    expect(chart.bars.map((b) => b.label)).toEqual(["v. 48", "v. 49"]);
  });
});
