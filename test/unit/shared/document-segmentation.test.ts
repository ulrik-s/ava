/**
 * Segmentering av sammansatta dokument (#1220) — syntetiska sidor.
 */

import { describe, expect, it, vi } from "vitest-compat";
import type { DocumentKind } from "@/lib/shared/document-kind";
import {
  DEFAULT_MAX_LLM_CALLS, detectPageStart, findCandidates, mergeAdjacent, overlayManualParts, segmentPages,
} from "@/lib/shared/document-segmentation";

const body = (s: string) => `${s}\nLorem ipsum dolor sit amet, text som fortsätter utan rubrik.\nMer brödtext.`;

describe("detectPageStart", () => {
  it.each<[string, DocumentKind]>([
    ["STOCKHOLMS TINGSRÄTT\nKALLELSE\nMål nr T 123-26", "KALLELSE"],
    ["STÄMNINGSANSÖKAN\nKärande: A", "STAMNING"],
    ["Stämning\nAnsökan har inkommit", "STAMNING"],
    ["FÖRUNDERSÖKNINGSPROTOKOLL\nÄrende 5000-K1", "FUP"],
    ["Delgivningskvitto\nUnderteckna och returnera", "DELGIVNINGSKVITTO"],
    ["Mottagningsbevis", "DELGIVNINGSKVITTO"],
    ["DOM\n2026-01-15\nmeddelad i Stockholm", "DOM"],
    ["Föreläggande\nNi ska yttra er", "DOM"],
    ["BESLUT: avvisning", "DOM"],
    ["Underrättelse\nBifogat översänds yttrande", "OKLASSIFICERAT"],
    ["YTTRANDE\nMål nr T 1-26", "INLAGA"],
    ["Svaromål", "INLAGA"],
    ["Fullmakt", "FULLMAKT"],
  ])("rubrik %j → %s", (text, kind) => {
    expect(detectPageStart(text)).toEqual({ kind });
  });

  it("ord som bara börjar likadant är ingen rubrik (domstol, stämningsman)", () => {
    expect(detectPageStart("Domstolen har tagit del av\nhandlingarna")).toBeNull();
    expect(detectPageStart("Stämningsmannen noterar")).toBeNull();
  });

  it("lång brödtextrad som börjar med rubrikordet ignoreras", () => {
    expect(detectPageStart("Dom meddelades i målet efter en lång huvudförhandling där parterna hördes utförligt")).toBeNull();
  });

  it("rubrik längre ned än topp-raderna räknas inte", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `rad ${i}`);
    expect(detectPageStart([...lines, "KALLELSE"].join("\n"))).toBeNull();
  });

  it("sidnumrering som börjar om → trolig start med okänd typ", () => {
    expect(detectPageStart("1 (4)\nText")).toEqual({ kind: null });
    expect(detectPageStart("Text\nmer\nSida 1 av 3")).toEqual({ kind: null });
    expect(detectPageStart("Sida 1 (2)\nText")).toEqual({ kind: null });
  });

  it("aktbilage-stämpel → trolig start", () => {
    expect(detectPageStart("Aktbil 12\nText")).toEqual({ kind: null });
    expect(detectPageStart("Aktbilaga 3")).toEqual({ kind: null });
  });

  it("vanlig fortsättningssida → ingen start", () => {
    expect(detectPageStart("2 (4)\nfortsättning")).toBeNull();
    expect(detectPageStart("")).toBeNull();
  });
});

describe("findCandidates", () => {
  it("sida 1 är alltid kandidat, även utan signal", () => {
    expect(findCandidates(["text", "mer", "KALLELSE"])).toEqual([
      { page: 1, kind: null }, { page: 3, kind: "KALLELSE" },
    ]);
  });
});

describe("mergeAdjacent", () => {
  it("slår ihop intilliggande delar med samma typ, men inte icke-intilliggande", () => {
    expect(mergeAdjacent([
      { kind: "DOM", fromPage: 1, toPage: 1 }, { kind: "DOM", fromPage: 2, toPage: 3 },
      { kind: "INLAGA", fromPage: 4, toPage: 4 }, { kind: "INLAGA", fromPage: 6, toPage: 6 },
    ])).toEqual([
      { kind: "DOM", fromPage: 1, toPage: 3 }, { kind: "INLAGA", fromPage: 4, toPage: 4 }, { kind: "INLAGA", fromPage: 6, toPage: 6 },
    ]);
  });
});

describe("segmentPages", () => {
  it("kallelse + stämning + FUP — rubriker räcker, ingen LLM", async () => {
    const classify = vi.fn(async (): Promise<DocumentKind | null> => "RAPPORT");
    const pages = [
      body("KALLELSE"), body("2 (2)"),
      body("STÄMNINGSANSÖKAN"), body("forts."), body("forts."),
      body("FÖRUNDERSÖKNINGSPROTOKOLL"), body("Förhör\n1 (3)"), body("Aktbil 4"), body("forts."),
    ];
    expect(await segmentPages(pages, { fallbackKind: "OKLASSIFICERAT", classify })).toEqual([
      { kind: "KALLELSE", fromPage: 1, toPage: 2 },
      { kind: "STAMNING", fromPage: 3, toPage: 5 },
      { kind: "FUP", fromPage: 6, toPage: 9 },
    ]);
    // Inne i FUP:en bryter sidnumrering/aktbilaga inte → ingen LLM alls.
    expect(classify).not.toHaveBeenCalled();
  });

  it("delgivningskvitto + dom", async () => {
    const pages = [body("Delgivningskvitto"), body("DOM"), body("forts."), body("forts.")];
    expect(await segmentPages(pages, { fallbackKind: "OKLASSIFICERAT" })).toEqual([
      { kind: "DELGIVNINGSKVITTO", fromPage: 1, toPage: 1 },
      { kind: "DOM", fromPage: 2, toPage: 4 },
    ]);
  });

  it("underrättelse + yttrande från motpart", async () => {
    const pages = [body("Underrättelse"), body("YTTRANDE"), body("forts.")];
    expect(await segmentPages(pages, { fallbackKind: "OKLASSIFICERAT" })).toEqual([
      { kind: "OKLASSIFICERAT", fromPage: 1, toPage: 1 },
      { kind: "INLAGA", fromPage: 2, toPage: 3 },
    ]);
  });

  it("enkeldokument utan rubriker: en LLM-fråga med hela texten", async () => {
    const classify = vi.fn(async (): Promise<DocumentKind | null> => "AVTAL");
    const pages = ["sida ett", "sida två"];
    expect(await segmentPages(pages, { fallbackKind: "OKLASSIFICERAT", classify })).toEqual([
      { kind: "AVTAL", fromPage: 1, toPage: 2 },
    ]);
    expect(classify).toHaveBeenCalledTimes(1);
    expect(classify.mock.calls[0]![0]).toBe("sida ett\n\nsida två");
  });

  it("utan LLM och utan rubrik → fallback-kategorin för hela dokumentet", async () => {
    expect(await segmentPages(["a", "b"], { fallbackKind: "FAKTURA" })).toEqual([{ kind: "FAKTURA", fromPage: 1, toPage: 2 }]);
  });

  it("LLM utan svar på sida 1 → fallback; på senare kandidat → hör till föregående del", async () => {
    const classify = vi.fn(async (): Promise<DocumentKind | null> => null);
    const pages = ["a", body("1 (2)"), "c"];
    expect(await segmentPages(pages, { fallbackKind: "BEVIS", classify })).toEqual([{ kind: "BEVIS", fromPage: 1, toPage: 3 }]);
    expect(classify).toHaveBeenCalledTimes(2);
    // Flera kandidater → bara kandidatsidans text, inte hela dokumentet.
    expect(classify.mock.calls[1]![0]).toBe(body("1 (2)"));
  });

  it("LLM avgör kandidater utan rubrik (sidnumrering börjar om)", async () => {
    const answers: Array<DocumentKind | null> = ["INLAGA", "BEVIS"];
    const classify = vi.fn(async () => answers.shift() ?? null);
    const pages = [body("1 (2)"), "forts.", body("Sida 1 av 1")];
    expect(await segmentPages(pages, { fallbackKind: "OKLASSIFICERAT", classify })).toEqual([
      { kind: "INLAGA", fromPage: 1, toPage: 2 }, { kind: "BEVIS", fromPage: 3, toPage: 3 },
    ]);
  });

  it("LLM-taket: utöver taket bara heuristik (300 sidor tar inte evigheter)", async () => {
    const classify = vi.fn(async (): Promise<DocumentKind | null> => "RAPPORT");
    const pages = Array.from({ length: 300 }, (_, i) => body(`${i % 2 === 0 ? "1 (2)" : "2 (2)"}`));
    const parts = await segmentPages(pages, { fallbackKind: "OKLASSIFICERAT", classify });
    expect(classify).toHaveBeenCalledTimes(DEFAULT_MAX_LLM_CALLS);
    expect(parts).toEqual([{ kind: "RAPPORT", fromPage: 1, toPage: 300 }]);
  });

  it("eget tak respekteras", async () => {
    const classify = vi.fn(async (): Promise<DocumentKind | null> => "RAPPORT");
    await segmentPages([body("1 (1)"), body("1 (1)"), body("1 (1)")], { fallbackKind: "OKLASSIFICERAT", classify, maxLlmCalls: 2 });
    expect(classify).toHaveBeenCalledTimes(2);
  });

  it("inga sidor → inga delar; en sida (DOCX) → en del", async () => {
    expect(await segmentPages([], { fallbackKind: "DOM" })).toEqual([]);
    expect(await segmentPages(["hela texten"], { fallbackKind: "DOM" })).toEqual([{ kind: "DOM", fromPage: 1, toPage: 1 }]);
  });
});

describe("overlayManualParts", () => {
  it("manuella delar vinner över sina sidor; automatiska fyller resten", () => {
    const auto = [{ kind: "KALLELSE" as const, fromPage: 1, toPage: 5 }, { kind: "FUP" as const, fromPage: 6, toPage: 9 }];
    const manual = [{ kind: "STAMNING" as const, fromPage: 3, toPage: 4 }];
    expect(overlayManualParts(auto, manual)).toEqual([
      { kind: "KALLELSE", fromPage: 1, toPage: 2, source: "AUTO" },
      { kind: "STAMNING", fromPage: 3, toPage: 4, source: "MANUAL" },
      { kind: "KALLELSE", fromPage: 5, toPage: 5, source: "AUTO" },
      { kind: "FUP", fromPage: 6, toPage: 9, source: "AUTO" },
    ]);
  });

  it("utan manuella delar → bara AUTO", () => {
    expect(overlayManualParts([{ kind: "DOM", fromPage: 1, toPage: 2 }], [])).toEqual([
      { kind: "DOM", fromPage: 1, toPage: 2, source: "AUTO" },
    ]);
  });

  it("manuell del som täcker allt → automatiska försvinner", () => {
    expect(overlayManualParts([{ kind: "DOM", fromPage: 1, toPage: 2 }], [{ kind: "INLAGA", fromPage: 1, toPage: 2 }])).toEqual([
      { kind: "INLAGA", fromPage: 1, toPage: 2, source: "MANUAL" },
    ]);
  });
});
