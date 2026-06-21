/**
 * `systemRouter.capabilities` + `serverCapabilities` (ADR 0027 / #641) — klientens
 * probe-endpoint och serverns annonserade förmågor.
 */

import { describe, it, expect, afterEach } from "vitest-compat";
import { serverCapabilities } from "@/lib/server/http/server-context";
import { systemRouter } from "@/lib/server/routers/system";
import { DEMO_CAPABILITIES, SELF_HOSTED_CAPABILITIES } from "@/lib/shared/capabilities";

describe("systemRouter.capabilities", () => {
  it("returnerar ctx.capabilities", async () => {
    const caller = systemRouter.createCaller({ capabilities: SELF_HOSTED_CAPABILITIES } as never);
    expect(await caller.capabilities()).toEqual(SELF_HOSTED_CAPABILITIES);
  });

  it("faller tillbaka på demo-baslinjen när ctx saknar capabilities", async () => {
    const caller = systemRouter.createCaller({} as never);
    expect(await caller.capabilities()).toEqual(DEMO_CAPABILITIES);
  });
});

describe("serverCapabilities", () => {
  afterEach(() => { delete process.env.AVA_LLM_ENDPOINT; delete process.env.AVA_LLM_MODEL; });

  it("sync/jobs/oidc/ledger/mailSync alltid på server-side", () => {
    const c = serverCapabilities();
    expect(c.sync && c.jobs && c.oidc && c.ledger && c.mailSync).toBe(true);
  });

  it("llm gate:as på en konfigurerad LLM-endpoint", () => {
    expect(serverCapabilities().llm).toBe(false);
    process.env.AVA_LLM_ENDPOINT = "http://localhost:11434";
    expect(serverCapabilities().llm).toBe(true);
  });
});
