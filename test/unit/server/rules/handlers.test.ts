/**
 * Tester för `buildLiveHandlers` och `buildNoopHandlers`.
 *
 * Coverage-mål: lyfta `handlers.ts` från 24% till >90%. Den är liten
 * (~70 rader prod-kod) så några riktade tester räcker.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildLiveHandlers, buildNoopHandlers } from "@/server/rules/handlers";
import * as emailModule from "@/server/services/email";
import * as analysisModule from "@/server/services/document-analysis";
import * as templatesModule from "@/server/rules/email-templates";

interface PrismaMock {
  avaEventLog: { findFirst: ReturnType<typeof vi.fn> };
  matter: { update: ReturnType<typeof vi.fn> };
  document: { findFirst: ReturnType<typeof vi.fn> };
}

function makeDeps() {
  const prisma: PrismaMock = {
    avaEventLog: { findFirst: vi.fn() },
    matter: { update: vi.fn() },
    document: { findFirst: vi.fn() },
  };
  const dataStore = {} as never;
  return { prisma: prisma as unknown as Parameters<typeof buildLiveHandlers>[0]["prisma"], _mock: prisma, dataStore, organizationId: "org-1" };
}

describe("buildLiveHandlers.sendEmail", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(emailModule, "sendEmail").mockResolvedValue(undefined);
    vi.spyOn(templatesModule, "renderEmail").mockReturnValue({
      subject: "Hej", text: "Innehåll", html: "<p>x</p>",
    });
  });

  it("renderar mall och skickar mail (utan idempotencyKey)", async () => {
    const deps = makeDeps();
    const h = buildLiveHandlers(deps);
    const ok = await h.sendEmail({ template: "generic", to: "a@b" });
    expect(ok).toBe(true);
    expect(templatesModule.renderEmail).toHaveBeenCalledWith("generic", {});
    expect(emailModule.sendEmail).toHaveBeenCalledWith({
      to: "a@b", subject: "Hej", text: "Innehåll", html: "<p>x</p>",
    });
  });

  it("idempotencyKey: hittar tidigare skickad → returnerar false utan att skicka", async () => {
    const deps = makeDeps();
    deps._mock.avaEventLog.findFirst.mockResolvedValue({ id: "evt-old" });
    const h = buildLiveHandlers(deps);
    const ok = await h.sendEmail({ template: "generic", to: "a@b", idempotencyKey: "k-1" });
    expect(ok).toBe(false);
    expect(emailModule.sendEmail).not.toHaveBeenCalled();
  });

  it("idempotencyKey: inget tidigare → skickar normalt", async () => {
    const deps = makeDeps();
    deps._mock.avaEventLog.findFirst.mockResolvedValue(null);
    const h = buildLiveHandlers(deps);
    const ok = await h.sendEmail({ template: "generic", to: "a@b", idempotencyKey: "k-2" });
    expect(ok).toBe(true);
    expect(emailModule.sendEmail).toHaveBeenCalled();
  });
});

describe("buildLiveHandlers.updateMatter", () => {
  it("kallar prisma.matter.update med rätt where + data", async () => {
    const deps = makeDeps();
    const h = buildLiveHandlers(deps);
    await h.updateMatter("m1", { status: "ARCHIVED" });
    expect(deps._mock.matter.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { status: "ARCHIVED" },
    });
  });
});

describe("buildLiveHandlers.extractFromDocument", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(analysisModule, "analyzeDocument").mockResolvedValue(undefined as never);
  });

  it("verifierar org-tillhörighet och triggar analyzeDocument", async () => {
    const deps = makeDeps();
    deps._mock.document.findFirst.mockResolvedValue({ id: "d1" });
    const h = buildLiveHandlers(deps);
    await h.extractFromDocument({ documentId: "d1", schema: {}, into: "x" });
    expect(deps._mock.document.findFirst).toHaveBeenCalledWith({
      where: { id: "d1", matter: { organizationId: "org-1" } },
      select: { id: true },
    });
    // analyzeDocument är fire-and-forget — ge den en tick
    await new Promise((r) => setImmediate(r));
    expect(analysisModule.analyzeDocument).toHaveBeenCalledWith("d1");
  });

  it("hoppar över när dokumentet inte tillhör org:n", async () => {
    const deps = makeDeps();
    deps._mock.document.findFirst.mockResolvedValue(null);
    const h = buildLiveHandlers(deps);
    await h.extractFromDocument({ documentId: "d1", schema: {}, into: "x" });
    expect(analysisModule.analyzeDocument).not.toHaveBeenCalled();
  });

  it("sväljer analyzeDocument-fel (fire-and-forget)", async () => {
    const deps = makeDeps();
    deps._mock.document.findFirst.mockResolvedValue({ id: "d1" });
    vi.spyOn(analysisModule, "analyzeDocument").mockRejectedValue(new Error("LLM nere"));
    const h = buildLiveHandlers(deps);
    await expect(h.extractFromDocument({ documentId: "d1", schema: {}, into: "x" })).resolves.toBeUndefined();
  });
});

describe("buildLiveHandlers.createTask", () => {
  it("loggar (stub tills task-modell finns)", async () => {
    const deps = makeDeps();
    const h = buildLiveHandlers(deps);
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    await h.createTask({ assignTo: "anna", title: "Granska", dueAt: "2026-06-01" });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("buildNoopHandlers", () => {
  it("spårar alla anrop i `calls`-arrayen", async () => {
    const h = buildNoopHandlers();
    await h.sendEmail({ template: "x", to: "a@b" });
    await h.updateMatter("m1", { x: 1 });
    await h.extractFromDocument({ documentId: "d1", schema: {}, into: "into" });
    await h.createTask({ assignTo: "anna", title: "T" });
    expect(h.calls.map((c) => c.name)).toEqual(["sendEmail", "updateMatter", "extractFromDocument", "createTask"]);
  });

  it("sendEmail returnerar alltid true", async () => {
    const h = buildNoopHandlers();
    expect(await h.sendEmail({ template: "x", to: "a@b" })).toBe(true);
  });
});
