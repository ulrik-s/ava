/**
 * Byråns sökregel för kontakter (#1866): unionen av jävsmatchningen och
 * delsträngsregeln, jävsträffar först.
 */
import { describe, expect, it } from "vitest-compat";
import { parseConflictQuery } from "@/lib/shared/conflict-match";
import { contactSearchRank, rankContacts, type ContactSearchCandidate } from "@/lib/shared/contact-search";

const ANNA: ContactSearchCandidate = { name: "Anna Karlsson", personalNumber: "19800101-1234", email: "anna@exempel.se" };

const rank = (c: ContactSearchCandidate, term: string): number =>
  contactSearchRank(c, parseConflictQuery(term), term.trim().toLocaleLowerCase("sv"));
const names = (cs: readonly ContactSearchCandidate[]): string[] => cs.map((c) => c.name);

describe("rankContacts — båda reglernas fall träffar", () => {
  it.each([
    ["Karlsson Anna", "omvänd ordning"],
    ["Karlson", "stavfel"],
    ["198001011234", "nummer utan bindestreck"],
    ["1234", "de fyra sista siffrorna"],
    ["anna@exempel", "e-post"],
    ["sson", "mitt i ordet"],
  ])("%s (%s)", (term) => {
    expect(names(rankContacts([ANNA], term))).toEqual(["Anna Karlsson"]);
  });
});

describe("contactSearchRank", () => {
  it("4/3/2 för jävspoängen 3/2/1, 1 för bara delsträng, 0 utan träff", () => {
    expect(rank(ANNA, "Anna 19800101-1234")).toBe(4);
    expect(rank(ANNA, "19800101-1234")).toBe(3);
    expect(rank(ANNA, "Anna")).toBe(2);
    expect(rank(ANNA, "exempel.se")).toBe(1);
    expect(rank(ANNA, "Bertil")).toBe(0);
  });

  it("orgnumret träffar som delsträng", () => {
    expect(rank({ name: "Bygg AB", orgNumber: "556677-8899" }, "7-88")).toBe(1);
  });

  it("saknade fält ger ingen träff och inget fel", () => {
    expect(rank({ name: "Bo", personalNumber: null, orgNumber: undefined, email: null }, "zz")).toBe(0);
  });
});

describe("rankContacts — ordning och specialfall", () => {
  it("bäst först, och inom samma rang i svensk ordning (Å/Ä/Ö efter Z)", () => {
    const cs: ContactSearchCandidate[] = [
      { name: "Örjan Berg" }, { name: "Zeta Berg" }, { name: "Åke Berg" }, { name: "Adam Berg" },
      { name: "Annberg Ek", email: "x@y.se" },
    ];
    expect(names(rankContacts(cs, "Berg"))).toEqual(["Adam Berg", "Zeta Berg", "Åke Berg", "Örjan Berg", "Annberg Ek"]);
  });

  it("%, _ och \\ är vanliga tecken", () => {
    const cs: ContactSearchCandidate[] = [
      { name: "Procent AB", email: "50%rabatt@x.se" }, { name: "Under AB", email: "a_b@x.se" },
      { name: "Snedstreck AB", email: "c\\d@x.se" }, { name: "Vanlig AB", email: "ab@x.se" },
    ];
    expect(names(rankContacts(cs, "%"))).toEqual(["Procent AB"]);
    expect(names(rankContacts(cs, "_"))).toEqual(["Under AB"]);
    expect(names(rankContacts(cs, "\\"))).toEqual(["Snedstreck AB"]);
  });

  it("Å/Ä/Ö jämförs utan skiftläge", () => {
    const cs: ContactSearchCandidate[] = [{ name: "Åsa Öberg" }];
    expect(names(rankContacts(cs, "åsa"))).toEqual(["Åsa Öberg"]);
    expect(names(rankContacts(cs, "ÖBERG"))).toEqual(["Åsa Öberg"]);
  });

  // Jävsmatchningen likställer å/ä/ö med a/o (oförändrad, conflict-match.ts);
  // delsträngsregeln skiljer dem åt. "SA Ö" når bara delsträngsregeln.
  it("delsträngsregeln skiljer Å/Ö från A/O", () => {
    const cs: ContactSearchCandidate[] = [{ name: "Åsa Öberg" }, { name: "Asa Oberg" }];
    expect(names(rankContacts(cs, "SA Ö"))).toEqual(["Åsa Öberg"]);
  });

  it("en term som är tom efter trim ger en tom lista", () => {
    expect(rankContacts([ANNA], "   ")).toEqual([]);
  });
});
