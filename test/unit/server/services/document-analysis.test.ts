import { describe, it, expect } from "vitest";
import {
  parseWithRepair,
  extractJsonObject,
  parseEventDate,
  truncate,
} from "@/server/services/document-analysis";

// ─── parseWithRepair ─────────────────────────────────────────────

describe("parseWithRepair — normalt välformat svar", () => {
  it("parsar välformad JSON från LLM:n", () => {
    const raw = `{
      "title": "Stämning",
      "documentType": "Stämningsansökan",
      "summary": "Kort sammanfattning.",
      "parties": [{ "name": "Anna", "role": "KLIENT", "contactType": "PERSON" }],
      "events": [{ "title": "Förhandling", "startAt": "2026-05-14", "allDay": true }]
    }`;

    const r = parseWithRepair(raw);
    expect(r).not.toBeNull();
    expect(r!.title).toBe("Stämning");
    expect(r!.parties).toHaveLength(1);
    expect(r!.events).toHaveLength(1);
    expect(r!.events![0].startAt).toBe("2026-05-14");
  });

  it("hanterar kodfencad JSON (```json ... ```)", () => {
    const raw = '```json\n{"title":"X","documentType":"Avtal","summary":"","parties":[]}\n```';
    const r = parseWithRepair(raw);
    expect(r).not.toBeNull();
    expect(r!.title).toBe("X");
  });

  it("hoppar över prosa före JSON-objektet", () => {
    const raw = 'Here is the JSON output:\n\n{"title":"Y","documentType":"Avtal","summary":"","parties":[]}';
    const r = parseWithRepair(raw);
    expect(r!.title).toBe("Y");
  });

  it("ignorerar klammrar inuti strängar", () => {
    const raw = '{"title":"Har { och } tecken","documentType":"Avtal","summary":"","parties":[]}';
    const r = parseWithRepair(raw);
    expect(r!.title).toBe("Har { och } tecken");
  });

  it("hanterar escape-tecken i strängar", () => {
    const raw = '{"title":"Med \\"citat\\"","documentType":"X","summary":"","parties":[]}';
    const r = parseWithRepair(raw);
    expect(r!.title).toBe('Med "citat"');
  });

  it("returnerar null om inget { finns", () => {
    expect(parseWithRepair("bara text utan JSON")).toBeNull();
    expect(parseWithRepair("")).toBeNull();
  });
});

describe("parseWithRepair — korrupt/avkortad utdata från lokal LLM", () => {
  it("reparerar när modellen skapar skräptoken mitt i ett objekt", () => {
    // Scenario observerat med Llama-3-8B: efter 'orgNumber: null,' dök en
    // ensam '"null"' token upp som bröt strukturen.
    const raw = `{
      "title": "Uppdragsavtal",
      "documentType": "Uppdragsavtal",
      "summary": "text",
      "parties": [
        {
          "name": "Anna",
          "role": "KLIENT",
          "contactType": "PERSON",
          "email": null,
          "phone": null,
          "orgNumber": null,
    "null"`;

    const r = parseWithRepair(raw);
    expect(r).not.toBeNull();
    expect(r!.title).toBe("Uppdragsavtal");
    // Parter blev avkortade men det vi hann få ska vara intakt
    expect(r!.parties).toBeDefined();
    expect(r!.parties[0].name).toBe("Anna");
    expect(r!.parties[0].role).toBe("KLIENT");
  });

  it("reparerar ren avkortning (max_tokens-nedhugg)", () => {
    const raw = `{
      "title": "Faktura",
      "documentType": "Faktura",
      "summary": "Konsulttimmar",
      "parties": [
        { "name": "Qnyx AB", "role": "KLIENT", "contactType": "COMPANY" },
        { "name": "Holmbee AB", "role": "MOTPART", "contactType": "COMPANY" }
      ],
      "events": [
        { "title": "Förfallodatum", "startAt": "2021-03-02", "allDay": true`;

    const r = parseWithRepair(raw);
    expect(r).not.toBeNull();
    expect(r!.parties).toHaveLength(2);
    // Det sista halvfärdiga eventet kan ha tappats, men parties är kompletta.
    expect(r!.parties[1].name).toBe("Holmbee AB");
  });

  it("returnerar null om strängen bara innehåller { utan struktur", () => {
    expect(parseWithRepair("{")).toBeNull();
  });

  it("reparerar med hängande komma (trailing comma)", () => {
    const raw = '{"title":"X","documentType":"Y","summary":"","parties":[],';
    const r = parseWithRepair(raw);
    expect(r).not.toBeNull();
    expect(r!.title).toBe("X");
    expect(r!.parties).toEqual([]);
  });
});

// ─── extractJsonObject ───────────────────────────────────────────

describe("extractJsonObject", () => {
  it("returnerar första balanserade objektet", () => {
    const s = '  prefix {"a":1,"b":{"c":2}} suffix';
    expect(extractJsonObject(s)).toBe('{"a":1,"b":{"c":2}}');
  });

  it("hittar objekt även när kod-fence omger det", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("returnerar null om inget { finns", () => {
    expect(extractJsonObject("inget objekt")).toBeNull();
  });

  it("ignorerar klammrar inuti strängar i extraktionsläge", () => {
    const s = '{"a":"har } i text","b":2}';
    expect(extractJsonObject(s)).toBe(s);
  });

  it("hanterar escape-tecken i strängar", () => {
    const s = '{"a":"med \\"citat\\"","b":1}';
    expect(extractJsonObject(s)).toBe(s);
  });

  it("repararar avkortat objekt via repairJson när inget balanserat objekt finns", () => {
    const s = '{"a":1,"b":2,';
    const repaired = extractJsonObject(s);
    expect(repaired).not.toBeNull();
    // skall vara parsbar
    expect(() => JSON.parse(repaired!)).not.toThrow();
    expect(JSON.parse(repaired!)).toEqual({ a: 1, b: 2 });
  });

  it("repararar nested truncated array", () => {
    const s = '{"a":[1,2,3,';
    const repaired = extractJsonObject(s);
    expect(repaired).not.toBeNull();
    expect(JSON.parse(repaired!)).toEqual({ a: [1, 2, 3] });
  });

  it("repararar bart öppet { till tomt objekt", () => {
    expect(extractJsonObject("{")).toBe("{}");
  });
});

// ─── parseWithRepair – fler kantfall ─────────────────────────────

describe("parseWithRepair – fler kantfall", () => {
  it("hanterar nested array av events där sista är trasig", () => {
    const raw = `{
      "title": "X",
      "documentType": "Y",
      "summary": "",
      "parties": [],
      "events": [
        { "title": "A", "startAt": "2026-01-01", "allDay": true },
        { "title": "B"`;
    const r = parseWithRepair(raw);
    expect(r).not.toBeNull();
    expect(r!.events![0].title).toBe("A");
  });

  it("returnerar null när JSON är helt skräp efter {", () => {
    expect(parseWithRepair("{ ren skräp utan citat eller :")).toBeNull();
  });
});

// ─── parseEventDate ──────────────────────────────────────────────

describe("parseEventDate", () => {
  it("tolkar bart datum ÅÅÅÅ-MM-DD som midnatt UTC", () => {
    const d = parseEventDate("2026-05-14");
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe("2026-05-14T00:00:00.000Z");
  });

  it("tolkar full ISO 8601 med tid", () => {
    const d = parseEventDate("2026-05-14T09:30:00Z");
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe("2026-05-14T09:30:00.000Z");
  });

  it("trimmar omgivande whitespace", () => {
    const d = parseEventDate("  2026-05-14  ");
    expect(d!.toISOString()).toBe("2026-05-14T00:00:00.000Z");
  });

  it("returnerar null för ogiltigt datum", () => {
    expect(parseEventDate("inte ett datum")).toBeNull();
    expect(parseEventDate("2026-13-45")).toBeNull();
    expect(parseEventDate("")).toBeNull();
  });
});

// ─── truncate ────────────────────────────────────────────────────

describe("truncate", () => {
  it("returnerar null för null/undefined/tomt", () => {
    expect(truncate(null, 10)).toBeNull();
    expect(truncate(undefined, 10)).toBeNull();
    expect(truncate("", 10)).toBeNull();
  });

  it("returnerar strängen oförändrad om den är kortare än max", () => {
    expect(truncate("hej", 10)).toBe("hej");
  });

  it("trimmar till max tecken", () => {
    expect(truncate("abcdefghij", 4)).toBe("abcd");
  });

  it("behandlar exakt gränsfall utan att kapa", () => {
    expect(truncate("abcd", 4)).toBe("abcd");
  });
});
