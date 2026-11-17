import { describe, expect, it } from "vitest-compat";
import { DASHBOARD_CLOSABLE, dashboardLayout } from "@/app/_dashboard-layout";
import { panelOrder, reconcileLayout, visiblePanels, type SerializedLayout } from "@/lib/shared/layout/dock-layout";

const DASHBOARD_PANELS = ["watch", "time", "recent"];
const leaf = (id: string, views: string[]) => ({ type: "leaf" as const, data: { id, views }, size: 100 });

/** En Startside-layout sparad innan Kalendern togs bort (#1623). */
const SAVED_WITH_CALENDAR: SerializedLayout = {
  grid: {
    root: { type: "branch", data: [leaf("g1", ["watch"]), { type: "branch", data: [leaf("g2", ["calendar"]), leaf("g3", ["time"])] }, leaf("g4", ["recent"])] },
    width: 1600, height: 900, orientation: "HORIZONTAL",
  },
  panels: { watch: { id: "watch" }, calendar: { id: "calendar" }, time: { id: "time" }, recent: { id: "recent" } },
  activeGroup: "g2",
};

function record(screen: "laptop" | "large") {
  const calls: Array<{ id: string; ref?: unknown }> = [];
  dashboardLayout((id, opts) => { calls.push({ id, ref: opts?.position }); }, screen);
  return calls;
}

describe("startsidans standardlayout (#1184)", () => {
  it("laptop: Att bevaka + Senaste ärenden till vänster, Tidrapportering till höger", () => {
    const calls = record("laptop");
    expect(calls.map((c) => c.id)).toEqual(["watch", "time", "recent"]);
    expect(calls[1]?.ref).toEqual({ referencePanel: "watch", direction: "right" });
    expect(calls[2]?.ref).toEqual({ referencePanel: "watch", direction: "below" });
  });

  it("stor skärm: Senaste ärenden i en egen kolumn", () => {
    const calls = record("large");
    expect(calls.map((c) => c.id)).toEqual(["watch", "time", "recent"]);
    expect(calls[2]?.ref).toEqual({ referencePanel: "time", direction: "right" });
  });

  it.each(["laptop", "large"] as const)("%s: ingen panel eller referens heter calendar (#1623)", (screen) => {
    expect(JSON.stringify(record(screen))).not.toContain("calendar");
  });
});

describe("startsidans valbara rutor (#1612)", () => {
  it("alla tre rutorna är valbara — Kalendern finns inte längre (#1623)", () => {
    expect(DASHBOARD_CLOSABLE).toEqual(["watch", "time", "recent"]);
  });
});

describe("sparad Startside-layout med Kalendern (#1623)", () => {
  it("kalenderrutan rensas, de tre övriga står kvar och inget saknas", () => {
    const r = reconcileLayout(SAVED_WITH_CALENDAR, DASHBOARD_PANELS);
    expect(r && panelOrder(r.layout)).toEqual(["watch", "time", "recent"]);
    expect(r && Object.keys(r.layout.panels)).not.toContain("calendar");
    expect(r?.missing).toEqual([]);
    expect(JSON.stringify(r?.layout.grid)).not.toContain("calendar");
  });

  it("alla tre rutorna stängda → inget kvar att visa (tomvyn med Lägg till ruta)", () => {
    const panels = DASHBOARD_PANELS.map((id) => ({ id }));
    expect(visiblePanels(panels, DASHBOARD_CLOSABLE, DASHBOARD_PANELS)).toEqual([]);
  });
});
