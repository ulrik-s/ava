import { describe, expect, it } from "vitest-compat";
import { invoiceLayout } from "@/app/invoices/[id]/_invoice-layout";

function record(screen: "laptop" | "large") {
  const calls: Array<{ id: string; ref?: unknown }> = [];
  invoiceLayout((id, opts) => { calls.push({ id, ref: opts?.position }); }, screen);
  return calls;
}

describe("fakturasidans standardlayout (#1184)", () => {
  it.each(["laptop", "large"] as const)("%s: varje panel exakt en gång", (screen) => {
    expect(record(screen).map((c) => c.id).sort()).toEqual(["dispatch", "documents", "payments", "spec", "summary"]);
  });

  it("laptop: underlagen som flikar till höger om översikten", () => {
    const calls = record("laptop");
    expect(calls.find((c) => c.id === "spec")?.ref).toEqual({ referencePanel: "summary", direction: "right" });
    expect(calls.find((c) => c.id === "documents")?.ref).toEqual({ referencePanel: "spec", direction: "within" });
  });

  it("stor skärm: dokument och utskick i en egen kolumn", () => {
    expect(record("large").find((c) => c.id === "documents")?.ref).toEqual({ referencePanel: "spec", direction: "right" });
  });
});
