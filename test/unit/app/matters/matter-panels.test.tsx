import { describe, expect, it } from "vitest-compat";
import { MATTER_PANEL_IDS, matterDefaultLayout, matterPanels } from "@/app/matters/[id]/_matter-panels";
import type { AddPanel } from "@/components/layout/dock-workspace";
import { panelOrder, reconcileLayout, type SerializedLayout } from "@/lib/shared/layout/dock-layout";

type Call = { id: string; opts?: Parameters<AddPanel>[1] };
function record(screen: "laptop" | "large"): Call[] {
  const calls: Call[] = [];
  matterDefaultLayout((id, opts) => { calls.push(opts ? { id, opts } : { id }); }, screen);
  return calls;
}

describe("ärendesidans paneler (#1185)", () => {
  it("registret har en titel och innehåll per panel", () => {
    const panels = matterPanels(Object.fromEntries(MATTER_PANEL_IDS.map((id) => [id, () => id])) as Parameters<typeof matterPanels>[0]);
    expect(panels.map((p) => p.id)).toEqual([...MATTER_PANEL_IDS]);
    expect(panels.find((p) => p.id === "time")?.title).toBe("Tid");
    expect(panels.find((p) => p.id === "watch")?.render()).toBe("watch");
  });

  it.each(["laptop", "large"] as const)("standardlayouten (%s) innehåller varje panel exakt en gång", (screen) => {
    const ids = record(screen).map((c) => c.id);
    expect([...ids].sort()).toEqual([...MATTER_PANEL_IDS].sort());
  });

  it("laptop: arbetet till vänster, bevakning till höger, dokument under", () => {
    const calls = record("laptop");
    expect(calls[0]).toEqual({ id: "time" });
    expect(calls.find((c) => c.id === "expenses")?.opts).toEqual({ position: { referencePanel: "time", direction: "within" }, inactive: true });
    expect(calls.find((c) => c.id === "watch")?.opts?.position).toEqual({ referencePanel: "time", direction: "right" });
    expect(calls.find((c) => c.id === "documents")?.opts?.position).toEqual({ referencePanel: "watch", direction: "below" });
  });

  it("stor skärm: tre kolumner", () => {
    const calls = record("large");
    expect(calls.find((c) => c.id === "billing")?.opts?.position).toEqual({ referencePanel: "time", direction: "right" });
    expect(calls.find((c) => c.id === "watch")?.opts?.position).toEqual({ referencePanel: "billing", direction: "right" });
  });

  it("fliken Betalningssätt finns inte längre (#1499)", () => {
    expect(MATTER_PANEL_IDS).not.toContain("payment");
  });

  it("en sparad layout med panelen payment öppnas utan den (#1499)", () => {
    const leaf = (id: string, views: string[], activeView: string) => ({ type: "leaf" as const, data: { id, views, activeView }, size: 100 });
    const saved: SerializedLayout = {
      grid: {
        root: { type: "branch", data: [leaf("g1", ["time", "expenses"], "time"), leaf("g2", ["payment", "watch"], "payment")] },
        width: 1200, height: 800, orientation: "HORIZONTAL",
      },
      panels: { time: { id: "time" }, expenses: { id: "expenses" }, payment: { id: "payment" }, watch: { id: "watch" } },
      activeGroup: "g2",
    };
    const r = reconcileLayout(saved, MATTER_PANEL_IDS);
    expect(r && panelOrder(r.layout)).toEqual(["time", "expenses", "watch"]);
    expect(r && Object.keys(r.layout.panels)).not.toContain("payment");
    const g2 = r?.layout.grid.root.type === "branch" ? r.layout.grid.root.data[1] : undefined;
    expect(g2?.type === "leaf" && g2.data.activeView).toBe("watch");
    expect(r?.missing).not.toContain("payment");
  });
});
