/**
 * Förfrågans framsteg (#2216): delarna ur arbetsordrarna (äldst först, utan
 * Conventional-Commit-prefix), godkänt-datumet, kön före och uppskattningen —
 * inget innan beslutet, ingen uppskattning efter leveransen.
 */
import { describe, expect, it } from "vitest-compat";
import { partTitle, progressFor, queueAhead, withProgress } from "@/lib/server/feedback/feedback-progress";
import type { WorkOrder, WorkOrderSnapshot } from "@/lib/server/ports";
import type { FeedbackItem } from "@/lib/shared/feedback";

const order = (intake: number, createdAt: string, state: WorkOrder["state"], title = `feat(x): del ${createdAt}`): WorkOrder =>
  ({ intake, title, state, createdAt });

const SNAPSHOT: WorkOrderSnapshot = {
  perDay: 20,
  orders: [
    order(7, "2026-11-24T10:00:00Z", "i_ko", "feat(matters): flytta ett mejl med bilagor"),
    order(7, "2026-11-23T10:00:00Z", "klar", "fix: flytta en tidspost"),
    order(7, "2026-11-23T11:00:00Z", "pagar", "refactor(documents)!: flytta ett dokument"),
    order(9, "2026-11-22T10:00:00Z", "i_ko"),
    order(9, "2026-11-22T11:00:00Z", "pagar"),
    order(9, "2026-11-25T10:00:00Z", "i_ko"),
  ],
};

const item = (over: Partial<FeedbackItem> = {}): FeedbackItem => ({
  number: 7, title: "Flytta", kind: "feature", state: "pagar", createdAt: "2026-11-22T09:00:00Z",
  release: null, messages: [], canReply: true, attachments: [], ...over,
});

describe("partTitle", () => {
  it.each([
    ["feat(feedback): tråden visar tidslinjen", "Tråden visar tidslinjen"],
    ["fix: summan blir rätt", "Summan blir rätt"],
    ["refactor(a-b)!: något", "Något"],
    ["Redan en mening", "Redan en mening"],
  ])("%p → %p", (title, expected) => {
    expect(partTitle(title)).toBe(expected);
  });
});

describe("queueAhead", () => {
  it("räknar andras delar i kön som skapats före den äldsta återstående delen", () => {
    const remaining = [order(7, "2026-11-23T11:00:00Z", "pagar")];
    // Bara #9:s första (i kön, skapad före); den pågående och den senare räknas inte.
    expect(queueAhead(7, remaining, SNAPSHOT.orders)).toBe(1);
  });

  it("ingen återstående del → ingen kö", () => {
    expect(queueAhead(7, [], SNAPSHOT.orders)).toBe(0);
  });
});

describe("progressFor", () => {
  it("delarna äldst först, klara, totalt och godkänt-datumet", () => {
    const p = progressFor(item(), SNAPSHOT);
    expect(p?.parts).toEqual([
      { title: "Flytta en tidspost", state: "klar" },
      { title: "Flytta ett dokument", state: "pagar" },
      { title: "Flytta ett mejl med bilagor", state: "i_ko" },
    ]);
    expect(p?.done).toBe(1);
    expect(p?.total).toBe(3);
    expect(p?.approvedAt).toBe("2026-11-23T10:00:00Z");
  });

  it("uppskattningen räknar återstående delar och kön före", () => {
    // (1 före + 2 kvar) / 20 + 0,5 → i dag eller i morgon
    expect(progressFor(item(), SNAPSHOT)?.eta).toEqual({
      kind: "range",
      label: "i dag eller i morgon",
      reason: "Två delar återstår. En del från andra förfrågningar ligger före i kön. AVA bygger ungefär 20 delar per dygn just nu. Uppskattningen uppdateras när något händer.",
    });
  });

  it("en blockerad del → väntar på beslut", () => {
    const snapshot = { perDay: 20, orders: [order(7, "2026-11-23T10:00:00Z", "vantar_beslut")] };
    expect(progressFor(item(), snapshot)?.eta).toEqual({ kind: "waiting", on: "beslut" });
  });

  it("väntar på användaren → väntar på dig", () => {
    expect(progressFor(item({ state: "vantar_pa_dig" }), SNAPSHOT)?.eta).toEqual({ kind: "waiting", on: "dig" });
  });

  it("alla klara men inte levererad → med nästa uppdatering", () => {
    const snapshot = { perDay: 20, orders: [order(7, "2026-11-23T10:00:00Z", "klar")] };
    expect(progressFor(item(), snapshot)?.eta).toEqual({ kind: "next_release" });
  });

  it.each(["levererad", "avslutad", "finns_redan", "uppdelad"] as const)("%s → delarna men ingen uppskattning", (state) => {
    const p = progressFor(item({ state }), SNAPSHOT);
    expect(p?.total).toBe(3);
    expect(p?.eta).toBeNull();
  });

  it.each(["mottagen", "undersokt", "ej_bekraftad"] as const)("%s (före beslutet) → inget", (state) => {
    expect(progressFor(item({ state }), SNAPSHOT)).toBeUndefined();
  });

  it("utan arbetsordrar → inget", () => {
    expect(progressFor(item({ number: 99 }), SNAPSHOT)).toBeUndefined();
  });
});

describe("withProgress", () => {
  it("lägger till progress där det finns delar, lämnar resten orörda", () => {
    const [a, b] = withProgress([item(), item({ number: 99 })], SNAPSHOT);
    expect(a?.progress?.total).toBe(3);
    expect(b).toEqual(item({ number: 99 }));
  });

  it("utan ögonblicksbild → oförändrade", () => {
    expect(withProgress([item()], null)).toEqual([item()]);
  });
});
