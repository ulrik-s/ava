import { describe, it, expect } from "vitest";
import { groupingKey, groupSuggestions, type RawSuggestion } from "@/lib/suggestion-grouping";

function sug(overrides: Partial<RawSuggestion> = {}): RawSuggestion {
  return {
    id: "s-1",
    name: "Anna Svensson",
    role: "KLIENT",
    contactType: "PERSON",
    email: null,
    phone: null,
    orgNumber: null,
    personalNumber: null,
    notes: null,
    document: { id: "doc-1", fileName: "stamning.pdf", title: "Stämning" },
    ...overrides,
  };
}

// ─── groupingKey ─────────────────────────────────────────────────

describe("groupingKey", () => {
  it("använder personalNumber när det finns", () => {
    expect(
      groupingKey({ name: "X", contactType: "PERSON", personalNumber: "19850315-1234", orgNumber: null })
    ).toBe("pn:19850315-1234");
  });

  it("använder orgNumber när personalNumber saknas", () => {
    expect(
      groupingKey({ name: "X", contactType: "COMPANY", personalNumber: null, orgNumber: "556123-4567" })
    ).toBe("on:556123-4567");
  });

  it("faller tillbaka på normaliserat namn + contactType", () => {
    expect(
      groupingKey({ name: "  Anna   Svensson  ", contactType: "PERSON", personalNumber: null, orgNumber: null })
    ).toBe("name:anna svensson|PERSON");
  });

  it("är skiftlägesokänslig i namn-fallback", () => {
    const a = groupingKey({ name: "Anna Svensson", contactType: "PERSON", personalNumber: null, orgNumber: null });
    const b = groupingKey({ name: "ANNA SVENSSON", contactType: "PERSON", personalNumber: null, orgNumber: null });
    expect(a).toBe(b);
  });

  it("skiljer olika contactType även med samma namn", () => {
    const person = groupingKey({ name: "Anna", contactType: "PERSON", personalNumber: null, orgNumber: null });
    const company = groupingKey({ name: "Anna", contactType: "COMPANY", personalNumber: null, orgNumber: null });
    expect(person).not.toBe(company);
  });

  it("prioriterar personalNumber över orgNumber", () => {
    expect(
      groupingKey({ name: "X", contactType: "PERSON", personalNumber: "19850315-1234", orgNumber: "556123-4567" })
    ).toBe("pn:19850315-1234");
  });
});

// ─── groupSuggestions — basfall ──────────────────────────────────

describe("groupSuggestions — deduplicering", () => {
  it("slår samman samma person i flera dokument till en grupp", () => {
    const groups = groupSuggestions([
      sug({ id: "s1", personalNumber: "19850315-1234", document: { id: "d1", fileName: "a.pdf", title: null } }),
      sug({ id: "s2", personalNumber: "19850315-1234", document: { id: "d2", fileName: "b.pdf", title: null } }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].suggestionIds).toEqual(["s1", "s2"]);
    expect(groups[0].documents).toHaveLength(2);
  });

  it("slår samman samma person med flera roller i samma dokument", () => {
    const groups = groupSuggestions([
      sug({ id: "s1", role: "KLIENT", personalNumber: "19850315-1234" }),
      sug({ id: "s2", role: "VITTNE", personalNumber: "19850315-1234" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].roles).toEqual(["KLIENT", "VITTNE"]);
    expect(groups[0].suggestionIds).toEqual(["s1", "s2"]);
  });

  it("dedupar på exakt samma dokument-id", () => {
    const groups = groupSuggestions([
      sug({ id: "s1", personalNumber: "19850315-1234", document: { id: "d1", fileName: "a.pdf", title: null } }),
      sug({ id: "s2", personalNumber: "19850315-1234", role: "VITTNE", document: { id: "d1", fileName: "a.pdf", title: null } }),
    ]);

    expect(groups[0].documents).toHaveLength(1);
    expect(groups[0].roles).toEqual(["KLIENT", "VITTNE"]);
  });

  it("separerar olika personer", () => {
    const groups = groupSuggestions([
      sug({ id: "s1", name: "Anna", personalNumber: "19850315-1234" }),
      sug({ id: "s2", name: "Bertil", personalNumber: "19600712-5678" }),
    ]);

    expect(groups).toHaveLength(2);
  });

  it("grupperar olika roller för samma företag via orgNumber", () => {
    const groups = groupSuggestions([
      sug({ id: "s1", name: "MG Advokater", contactType: "LAW_FIRM", role: "MOTPARTSOMBUD", orgNumber: "556123-4567" }),
      sug({ id: "s2", name: "MG Advokater AB", contactType: "LAW_FIRM", role: "OMBUD", orgNumber: "556123-4567" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].roles).toEqual(["MOTPARTSOMBUD", "OMBUD"]);
  });

  it("slår samman på normaliserat namn när ID saknas", () => {
    const groups = groupSuggestions([
      sug({ id: "s1", name: "Anna Svensson" }),
      sug({ id: "s2", name: "ANNA  SVENSSON", role: "VITTNE" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].roles).toEqual(["KLIENT", "VITTNE"]);
  });
});

// ─── groupSuggestions — attributs-sammanfogning ─────────────────

describe("groupSuggestions — attribut tas från första icke-tomma", () => {
  it("fyller i saknade attribut från senare dokument", () => {
    const groups = groupSuggestions([
      sug({ id: "s1", personalNumber: "19850315-1234", email: null, phone: null }),
      sug({ id: "s2", personalNumber: "19850315-1234", email: "anna@example.se", phone: "0701234567" }),
    ]);

    expect(groups[0].email).toBe("anna@example.se");
    expect(groups[0].phone).toBe("0701234567");
  });

  it("behåller första icke-tomma värdet när båda dokumenten har värden", () => {
    const groups = groupSuggestions([
      sug({ id: "s1", personalNumber: "19850315-1234", email: "anna@old.se" }),
      sug({ id: "s2", personalNumber: "19850315-1234", email: "anna@new.se" }),
    ]);

    expect(groups[0].email).toBe("anna@old.se");
  });

  it("samlar distinkta anteckningar", () => {
    const groups = groupSuggestions([
      sug({ id: "s1", personalNumber: "19850315-1234", notes: "Nämnd som klient" }),
      sug({ id: "s2", personalNumber: "19850315-1234", notes: "Nämnd som vittne" }),
      sug({ id: "s3", personalNumber: "19850315-1234", notes: "Nämnd som klient" }), // dup
    ]);

    expect(groups[0].notes).toEqual(["Nämnd som klient", "Nämnd som vittne"]);
  });

  it("undviker dubbel-roller", () => {
    const groups = groupSuggestions([
      sug({ id: "s1", role: "KLIENT", personalNumber: "19850315-1234" }),
      sug({ id: "s2", role: "KLIENT", personalNumber: "19850315-1234" }),
    ]);

    expect(groups[0].roles).toEqual(["KLIENT"]);
  });
});

// ─── Edge cases ──────────────────────────────────────────────────

describe("groupSuggestions — edge cases", () => {
  it("returnerar tom array för tom input", () => {
    expect(groupSuggestions([])).toEqual([]);
  });

  it("hanterar whitespace-personalNumber som tomt", () => {
    const groups = groupSuggestions([
      sug({ id: "s1", name: "Anna", personalNumber: "   " }),
      sug({ id: "s2", name: "Anna", personalNumber: null }),
    ]);

    // Faller tillbaka på name → båda hamnar i samma grupp
    expect(groups).toHaveLength(1);
  });
});
