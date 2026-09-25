import { describe, expect, it } from "vitest-compat";
import { dashboardLayout } from "@/app/_dashboard-layout";

function record(screen: "laptop" | "large") {
  const calls: Array<{ id: string; ref?: unknown }> = [];
  dashboardLayout((id, opts) => { calls.push({ id, ref: opts?.position }); }, screen);
  return calls;
}

describe("startsidans standardlayout (#1184)", () => {
  it("laptop: Att bevaka + Senaste ärenden till vänster, dagen till höger", () => {
    const calls = record("laptop");
    expect(calls.map((c) => c.id)).toEqual(["watch", "calendar", "time", "recent"]);
    expect(calls[3]?.ref).toEqual({ referencePanel: "watch", direction: "below" });
  });

  it("stor skärm: Senaste ärenden i en egen kolumn", () => {
    expect(record("large")[3]?.ref).toEqual({ referencePanel: "calendar", direction: "right" });
  });
});
