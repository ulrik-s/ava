/**
 * `inProcessPorts` (#1156) — vem klassar dokument i klientens in-process-tRPC.
 * Demo: klientens jobb (ingen server finns). Self-hosted: ingen — servern äger
 * klassificeringen, och klientens gissning skrev annars över serverns svar.
 */
import { describe, expect, it } from "vitest-compat";
import { inProcessPorts } from "@/lib/client/backend/in-process-ports";
import { StaticContentStore } from "@/lib/client/backend/static-content-store";
import type { FirmaConfig } from "@/lib/client/firma/firma-config";
import { demoDocumentAnalyzer } from "@/lib/server/adapters/demo-document-analyzer";
import { noopDocumentAnalyzer } from "@/lib/server/adapters/noop-ports";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";

const config = (tier: FirmaConfig["tier"]): FirmaConfig => ({
  tier, repo: "u/r", token: "", organizationId: "o", authorName: "A", authorEmail: "a@a.se",
});

describe("inProcessPorts", () => {
  it("demo: klientens klassificeringsjobb (ingen server finns)", () => {
    expect(inProcessPorts(new DemoDataStore({}), config("demo")).documentAnalyzer).toBe(demoDocumentAnalyzer);
  });

  it("self-hosted: ingen lokal klassning — servern äger den", () => {
    expect(inProcessPorts(new DemoDataStore({}), config("self-hosted")).documentAnalyzer).toBe(noopDocumentAnalyzer);
  });

  it("båda: dokumentinnehållet läses via den statiska content-porten", () => {
    expect(inProcessPorts(new DemoDataStore({}), config("demo")).content).toBeInstanceOf(StaticContentStore);
    expect(inProcessPorts(new DemoDataStore({}), config("self-hosted")).content).toBeInstanceOf(StaticContentStore);
  });
});
