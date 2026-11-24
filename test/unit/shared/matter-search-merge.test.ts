/**
 * Sammanslagen ärendesökning (#1642): ärendelistans träffar + jävsträffar i en
 * lista, ett ärende per rad, med texterna för "Träff".
 */

import { describe, it, expect } from "vitest-compat";
import {
  conflictHitText, mergeMatterSearch, ownFieldHits, type MergeConflictHit, type MergeableMatter,
} from "@/lib/shared/matter-search-merge";

const roleLabel = (r: string): string => ({ MOTPART: "Motpart", KLIENT: "Klient", VITTNE: "Vittne" } as Record<string, string>)[r] ?? r;

const matter = (id: string, over: Partial<MergeableMatter> = {}): MergeableMatter => ({
  id, matterNumber: `2026-000${id}`, title: `Ärende ${id}`, parties: [], ...over,
});

const hit = (matterId: string, over: Partial<MergeConflictHit> = {}): MergeConflictHit => ({
  matterId, contactName: "Anna Andersson", role: "MOTPART", ...over,
});

describe("ownFieldHits", () => {
  it("anger vilka av ärendets egna fält som innehåller termen, skiftlägesokänsligt", () => {
    const m = matter("1", {
      matterNumber: "AA2026-0001", title: "Bodelning Andersson", courtCaseNumber: "T 123-26",
      previousCourtCaseNumber: "T 99-25", insuranceReference: "FÖRS-123",
    });
    expect(ownFieldHits(m, "andersson", roleLabel)).toEqual(["Titel"]);
    expect(ownFieldHits(m, "aa2026", roleLabel)).toEqual(["Ärendenr"]);
    expect(ownFieldHits(m, "123", roleLabel)).toEqual(["Målnummer", "Försäkringsreferens"]);
    expect(ownFieldHits(m, "t 99", roleLabel)).toEqual(["Tidigare målnummer"]);
  });

  it("tom term eller ingen träff ger inga texter", () => {
    const m = matter("1", { parties: [{ role: "KLIENT", name: "Bo Klient" }] });
    expect(ownFieldHits(m, "   ", roleLabel)).toEqual([]);
    expect(ownFieldHits(m, "finns inte", roleLabel)).toEqual([]);
  });

  it("en part vars namn innehåller termen ger '<roll>: <namn>' (#1870)", () => {
    const m = matter("1", { parties: [{ role: "KLIENT", name: "Bo Klient" }, { role: "MOTPART", name: "Byggfirma Stenhammar AB" }] });
    expect(ownFieldHits(m, "STENHAM", roleLabel)).toEqual(["Motpart: Byggfirma Stenhammar AB"]);
    expect(ownFieldHits(m, " klient ", roleLabel)).toEqual(["Klient: Bo Klient"]);
  });

  it("flera parter som träffar ger en text var, i parternas ordning, efter ärendets egna fält", () => {
    const m = matter("1", {
      title: "Berg mot Bergström",
      parties: [{ role: "KLIENT", name: "Anna Berg" }, { role: "VITTNE", name: "Eva Bergström" }],
    });
    expect(ownFieldHits(m, "berg", roleLabel)).toEqual(["Titel", "Klient: Anna Berg", "Vittne: Eva Bergström"]);
  });

  it("en part i skip visas inte; samma namn i en annan roll visas fortfarande", () => {
    const m = matter("1", { parties: [{ role: "MOTPART", name: "Anna Andersson" }, { role: "VITTNE", name: "Anna Andersson" }] });
    const skip = new Set([`MOTPART\u0000Anna Andersson`]);
    expect(ownFieldHits(m, "anna", roleLabel, skip)).toEqual(["Vittne: Anna Andersson"]);
  });
});

describe("conflictHitText", () => {
  it("roll + namn, med person- eller orgnummer när det finns", () => {
    expect(conflictHitText(hit("1"), roleLabel)).toBe("Motpart: Anna Andersson");
    expect(conflictHitText(hit("1", { personalNumber: "19800101-1234" }), roleLabel)).toBe("Motpart: Anna Andersson (19800101-1234)");
    expect(conflictHitText(hit("1", { orgNumber: "556000-0000" }), roleLabel)).toBe("Motpart: Anna Andersson (556000-0000)");
  });
});

describe("mergeMatterSearch", () => {
  it("utan jävsträffar: ärendelistans sida med träffarna på egna fält", () => {
    const rows = mergeMatterSearch({
      term: "Ärende 2", conflictHits: [], conflictMatters: [], listMatters: [matter("1"), matter("2")], roleLabel,
    });
    expect(rows.map((r) => [r.id, r.hits])).toEqual([["1", []], ["2", ["Titel"]]]);
  });

  it("jävsträffarnas ärenden överst, bäst först; listans ärenden efter utan dubbletter", () => {
    const rows = mergeMatterSearch({
      term: "Andersson",
      conflictHits: [hit("3"), hit("1", { role: "VITTNE" })],
      conflictMatters: [matter("1"), matter("3")],
      listMatters: [matter("1", { title: "Andersson mot X" }), matter("2", { title: "Andersson" })],
      roleLabel,
    });
    expect(rows.map((r) => r.id)).toEqual(["3", "1", "2"]);
    expect(rows[2]?.hits).toEqual(["Titel"]);
  });

  it("ett ärende som matchar både på titel och via en part visas en gång med båda träffarna", () => {
    const both = matter("1", { title: "Anna Andersson ./. Bo" });
    const rows = mergeMatterSearch({
      term: "Anna Andersson", conflictHits: [hit("1")], conflictMatters: [both], listMatters: [both], roleLabel,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hits).toEqual(["Titel", "Motpart: Anna Andersson"]);
  });

  it("flera träffar i samma ärende samlas i samma rad; samma text bara en gång", () => {
    const rows = mergeMatterSearch({
      term: "Anna",
      conflictHits: [hit("1"), hit("1", { role: "KLIENT", contactName: "Anna Berg" }), hit("1")],
      conflictMatters: [matter("1")],
      listMatters: [],
      roleLabel,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hits).toEqual(["Motpart: Anna Andersson", "Klient: Anna Berg"]);
  });

  it("en part som redan är jävsträff på raden visas bara som jävsträffen (#1870)", () => {
    const m = matter("1", { parties: [{ role: "KLIENT", name: "Bo Klient" }, { role: "MOTPART", name: "Anna Andersson" }] });
    const rows = mergeMatterSearch({
      term: "Anna", conflictHits: [hit("1", { orgNumber: "556000-0000" })], conflictMatters: [m], listMatters: [], roleLabel,
    });
    expect(rows[0]?.hits).toEqual(["Motpart: Anna Andersson (556000-0000)"]);
  });

  it("listans ärenden utan jävsträff visar parterna som träffar", () => {
    const m = matter("2", { parties: [{ role: "MOTPART", name: "Byggfirma Stenhammar AB" }] });
    const rows = mergeMatterSearch({ term: "stenham", conflictHits: [], conflictMatters: [], listMatters: [m], roleLabel });
    expect(rows[0]?.hits).toEqual(["Motpart: Byggfirma Stenhammar AB"]);
  });

  it("en jävsträff vars ärende inte hämtades hoppas över", () => {
    const rows = mergeMatterSearch({
      term: "Anna", conflictHits: [hit("9")], conflictMatters: [], listMatters: [matter("1")], roleLabel,
    });
    expect(rows.map((r) => r.id)).toEqual(["1"]);
  });
});
