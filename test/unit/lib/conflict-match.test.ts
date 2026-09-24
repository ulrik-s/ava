/**
 * Jävskontrollens matchning (#1123): förnamn, efternamn och personnummer —
 * tillsammans eller var för sig. En jävskontroll får inte missa.
 */
import { describe, expect, it } from "bun:test";
import { conflictScore, parseConflictQuery, type ConflictSearchType } from "@/lib/shared/conflict-match";

const anna = { name: "Anna Karlsson", personalNumber: "19800101-1234", orgNumber: null };
const annaKarin = { name: "Anna-Karin Öberg", personalNumber: "850505-4321", orgNumber: null };
const bolag = { name: "Lindström Bygg AB", personalNumber: null, orgNumber: "556677-8899" };

const hit = (c: typeof anna | typeof bolag, term: string, type: ConflictSearchType = "both") =>
  conflictScore(c, parseConflictQuery(term, type), type) > 0;

describe("jävskontroll — namn", () => {
  it("förnamnet ensamt ger träff (missades förut: 'Anna' mot 'Anna Karlsson')", () => {
    expect(hit(anna, "Anna")).toBe(true);
  });

  it("efternamnet ensamt ger träff", () => {
    expect(hit(anna, "Karlsson")).toBe(true);
  });

  it("för- och efternamn i valfri ordning, även med kommatecken", () => {
    expect(hit(anna, "Anna Karlsson")).toBe(true);
    expect(hit(anna, "Karlsson Anna")).toBe(true);
    expect(hit(anna, "Karlsson, Anna")).toBe(true);
  });

  it("början av ett namn räcker (prefix)", () => {
    expect(hit(anna, "Karls")).toBe(true);
  });

  it("ett stavfel i ett längre namn ger ändå träff", () => {
    expect(hit(anna, "Karlson")).toBe(true);
    expect(hit(anna, "Ana Karlsson")).toBe(false); // "ana" (3 tecken) måste stämma exakt/prefix
  });

  it("dubbelnamn och å/ä/ö", () => {
    expect(hit(annaKarin, "Karin")).toBe(true);
    expect(hit(annaKarin, "oberg")).toBe(true);
    expect(hit(annaKarin, "Öberg")).toBe(true);
  });

  it("ALLA namnord måste stämma — 'Anna Svensson' är inte Anna Karlsson", () => {
    expect(hit(anna, "Anna Svensson")).toBe(false);
  });

  it("företagsnamn", () => {
    expect(hit(bolag, "Lindström")).toBe(true);
    expect(hit(bolag, "lindstrom bygg")).toBe(true);
  });
});

describe("jävskontroll — personnummer/orgnummer", () => {
  it("med och utan bindestreck, med och utan sekel", () => {
    expect(hit(anna, "19800101-1234")).toBe(true);
    expect(hit(anna, "198001011234")).toBe(true);
    expect(hit(anna, "800101-1234")).toBe(true);
    expect(hit(anna, "8001011234")).toBe(true);
  });

  it("lagrat utan sekel, sökt med sekel", () => {
    expect(hit(annaKarin, "19850505-4321")).toBe(true);
  });

  it("orgnummer", () => {
    expect(hit(bolag, "556677-8899")).toBe(true);
    expect(hit(bolag, "5566778899")).toBe(true);
  });

  it("fel nummer ger ingen träff", () => {
    expect(hit(anna, "19800101-9999")).toBe(false);
  });

  it("i nummerläget räcker de fyra sista siffrorna", () => {
    expect(hit(anna, "1234", "personalNumber")).toBe(true);
  });
});

describe("jävskontroll — namn och nummer tillsammans", () => {
  it("namn + personnummer ger träff — och rankas högst", () => {
    const q = parseConflictQuery("Anna 19800101-1234");
    expect(conflictScore(anna, q, "both")).toBe(3);
  });

  it("rätt nummer men felstavat namn ger ÄNDÅ träff — en jävskontroll får inte missa", () => {
    expect(hit(anna, "Annika 19800101-1234")).toBe(true);
  });

  it("rätt namn men fel nummer ger ändå träff på namnet", () => {
    expect(conflictScore(anna, parseConflictQuery("Anna Karlsson 19800101-9999"), "both")).toBe(1);
  });
});

describe("jävskontroll — söktyp", () => {
  it("'name' ignorerar nummer, 'personalNumber' ignorerar namn", () => {
    expect(hit(anna, "19800101-1234", "name")).toBe(false);
    expect(hit(anna, "Anna", "personalNumber")).toBe(false);
  });

  it("parseConflictQuery skiljer namnord från nummer", () => {
    expect(parseConflictQuery("Anna Karlsson 19800101-1234")).toEqual({
      nameTokens: ["anna", "karlsson"],
      numberTokens: ["198001011234"],
    });
  });
});
