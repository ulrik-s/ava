/**
 * Uppskattningen av leveransen (#2216): väntar på dig/beslut utan datum,
 * "med nästa uppdatering" när allt är klart, annars ett spann i ord med skäl —
 * varje trappsteg och dess gräns.
 */
import { describe, expect, it } from "vitest-compat";
import { feedbackItemSchema } from "@/lib/shared/feedback";
import { estimateDelivery, etaLabel, etaReason, RELEASE_LAG_DAYS } from "@/lib/shared/feedback-eta";

const BASE = { remaining: 2, queueAhead: 0, perDay: 20, blocked: false, waitingForUser: false };

describe("estimateDelivery", () => {
  it("väntar på användaren före allt annat", () => {
    expect(estimateDelivery({ ...BASE, waitingForUser: true, blocked: true, remaining: 0 })).toEqual({ kind: "waiting", on: "dig" });
  });

  it("en del som väntar på beslut stoppar uppskattningen", () => {
    expect(estimateDelivery({ ...BASE, blocked: true })).toEqual({ kind: "waiting", on: "beslut" });
  });

  it("alla delar klara → med nästa uppdatering", () => {
    expect(estimateDelivery({ ...BASE, remaining: 0 })).toEqual({ kind: "next_release" });
  });

  it("ger ett spann med skäl: (kö + återstående) / takt + releasefördröjning", () => {
    // (0 + 2) / 20 + 0,5 = 0,6 dygn
    expect(estimateDelivery(BASE)).toEqual({
      kind: "range",
      label: "i dag eller i morgon",
      reason: "Två delar återstår. AVA bygger ungefär 20 delar per dygn just nu. Uppskattningen uppdateras när något händer.",
    });
  });

  it("kön före räknas in", () => {
    // (30 + 2) / 20 + 0,5 = 2,1 dygn
    const eta = estimateDelivery({ ...BASE, queueAhead: 30 });
    expect(eta).toMatchObject({ kind: "range", label: "inom ungefär en vecka" });
  });

  it("takten noll ger längre än en vecka, aldrig ett fel", () => {
    expect(estimateDelivery({ ...BASE, perDay: 0 })).toMatchObject({ kind: "range", label: "längre än en vecka" });
  });

  it("releasefördröjningen är ett halvt dygn", () => {
    expect(RELEASE_LAG_DAYS).toBe(0.5);
  });
});

describe("etaLabel — trappstegen och deras gränser", () => {
  it.each([
    [0.5, "i dag eller i morgon"],
    [1, "i dag eller i morgon"],
    [1.01, "inom 1–2 dagar"],
    [2, "inom 1–2 dagar"],
    [2.01, "inom ungefär en vecka"],
    [7, "inom ungefär en vecka"],
    [7.01, "längre än en vecka"],
    [Number.POSITIVE_INFINITY, "längre än en vecka"],
  ])("%p dygn → %p", (days, label) => {
    expect(etaLabel(days)).toBe(label);
  });
});

describe("etaReason", () => {
  it("en del, en per dygn — singular", () => {
    expect(etaReason(1, 0, 1)).toBe("En del återstår. AVA bygger ungefär en del per dygn just nu. Uppskattningen uppdateras när något händer.");
  });

  it("stora tal med siffror, takten avrundad", () => {
    expect(etaReason(13, 0, 23.6)).toBe("13 delar återstår. AVA bygger ungefär 24 delar per dygn just nu. Uppskattningen uppdateras när något händer.");
  });

  it("nämner kön före när den finns", () => {
    expect(etaReason(2, 1, 10)).toContain("Två delar återstår. En del från andra förfrågningar ligger före i kön. AVA bygger");
    expect(etaReason(2, 5, 10)).toContain("Fem delar från andra förfrågningar ligger före i kön.");
  });

  it("en takt under en halv del per dygn", () => {
    expect(etaReason(2, 0, 0.4)).toContain("AVA bygger just nu färre än en del per dygn.");
  });
});

describe("feedbackItemSchema.progress", () => {
  const ITEM = { number: 1, title: "t", kind: "feature", state: "pagar", createdAt: "2026-11-20T10:00:00Z", release: null, messages: [], canReply: true };

  it("ett äldre svar utan progress går fortfarande att läsa", () => {
    expect(feedbackItemSchema.parse(ITEM).progress).toBeUndefined();
    expect(feedbackItemSchema.parse({ ...ITEM, progress: null }).progress).toBeNull();
  });

  it("läser delar och uppskattning", () => {
    const progress = { parts: [{ title: "A", state: "klar" }], done: 1, total: 1, approvedAt: null, eta: { kind: "next_release" } };
    expect(feedbackItemSchema.parse({ ...ITEM, progress }).progress).toEqual(progress);
  });
});
