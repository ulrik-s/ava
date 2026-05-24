/**
 * Tester för bigram-Jaccard-similaritet (`fuzzy-similarity.ts`).
 *
 * Detta är drop-in-ersättning för PostgreSQL:s pg_trgm.similarity() i
 * pure-git-modellen, så vi vill ha pragmatiska, inte exakta, värden.
 */

import { describe, it, expect } from "vitest";
import { bigrams, normalize, similarity } from "@/client/lib/fuzzy-similarity";

describe("normalize", () => {
  it("lowercase + strippar diakritik", () => {
    expect(normalize("Åsa Östberg")).toBe("asa ostberg");
    expect(normalize("Anna-Lena Édén")).toBe("anna lena eden");
  });

  it("collapsar whitespace + strippar interpunktion", () => {
    expect(normalize("Hej,  världen!")).toBe("hej varlden");
    expect(normalize("  flera   blanksteg  ")).toBe("flera blanksteg");
  });

  it("behåller siffror", () => {
    expect(normalize("Mål T 1234-26")).toBe("mal t 1234 26");
  });
});

describe("bigrams", () => {
  it("returnerar överlappande 2-tecken-windows", () => {
    expect(Array.from(bigrams("anna")).sort()).toEqual(["an", "na", "nn"]);
    expect(Array.from(bigrams("ab"))).toEqual(["ab"]);
  });

  it("hanterar mycket korta strängar", () => {
    expect(Array.from(bigrams(""))).toEqual([]);
    expect(Array.from(bigrams("a"))).toEqual(["a"]);
  });

  it("dedupliperar bigram (set-semantik)", () => {
    expect(bigrams("aaaaa").size).toBe(1);
  });
});

describe("similarity", () => {
  it("1.0 för identiska strängar", () => {
    expect(similarity("Anna Andersson", "Anna Andersson")).toBe(1);
  });

  it("0 för helt åtskilda strängar", () => {
    expect(similarity("Anna", "Bob")).toBe(0);
  });

  it("hög score för mindre stavfel", () => {
    expect(similarity("Anna Andersson", "Ana Andersson")).toBeGreaterThan(0.5);
    expect(similarity("Erik Persson", "Eric Persson")).toBeGreaterThan(0.5);
  });

  it("hanterar svensk diakritik via normalize", () => {
    expect(similarity("Åsa Östberg", "Asa Ostberg")).toBe(1);
  });

  it("är symmetrisk", () => {
    const a = similarity("Anna Andersson", "Anna Andresson");
    const b = similarity("Anna Andresson", "Anna Andersson");
    expect(a).toBe(b);
  });

  it("hanterar tomma inputs", () => {
    expect(similarity("", "Anna")).toBe(0);
    expect(similarity("Anna", "")).toBe(0);
    expect(similarity("", "")).toBe(0);
  });

  it("ger samma resultat oavsett ordning på case/whitespace", () => {
    expect(similarity("ANNA  Andersson", "anna andersson")).toBe(1);
  });

  it("särskiljer namn som har överlapp i bara delar", () => {
    // Anna Andersson vs Anna — delvis match
    const partial = similarity("Anna Andersson", "Anna");
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(0.5);
  });
});
