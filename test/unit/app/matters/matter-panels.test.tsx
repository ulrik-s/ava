import { describe, expect, it } from "vitest-compat";
import { MATTER_PANEL_IDS, matterDefaultLayout, matterPanels } from "@/app/matters/[id]/_matter-panels";
import type { AddPanel } from "@/components/layout/dock-workspace";

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
});
