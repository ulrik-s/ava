/**
 * `normalizeSubject` (#929) — Dependabots versala "Bump" fäller commitlints
 * `subject-case` och gör hela PR:en röd.
 *
 * Vi skriver om meddelandet i stället för att undanta Dependabot från grinden.
 * Testerna vaktar två motstående krav: versalen MÅSTE bort, men akronymer
 * (`SHA`, `OPFS`) och egennamn längre in i meningen får inte förstöras — och
 * icke-Dependabot-meddelanden ska passera helt orörda.
 */
import { describe, it, expect } from "vitest-compat";
import { needsNormalizing, normalizeSubject } from "../../tooling/scripts/normalize-commit-subject";

describe("normalizeSubject", () => {
  it("gemenar Dependabots versala Bump — det faktiska felet", () => {
    expect(normalizeSubject("ci: Bump the actions-all group with 8 updates"))
      .toBe("ci: bump the actions-all group with 8 updates");
  });

  it("lämnar ett redan gement subject orört", () => {
    const ok = "chore(deps): bump zod from 3.1.0 to 3.2.0";
    expect(normalizeSubject(ok)).toBe(ok);
    expect(needsNormalizing(ok)).toBe(false);
  });

  it("bevarar scope och utropstecken (breaking change)", () => {
    expect(normalizeSubject("chore(deps-dev)!: Update knip to 7")).
      toBe("chore(deps-dev)!: update knip to 7");
  });

  it("rör INTE akronymer — SHA-pinna och OPFS ska förbli versala", () => {
    const sha = "ci: SHA-pinna alla actions";
    expect(normalizeSubject(sha)).toBe(sha);
    const opfs = "fix: OPFS-cachen töms vid utloggning";
    expect(normalizeSubject(opfs)).toBe(opfs);
  });

  it("rör inte versaler längre in i meningen", () => {
    const s = "ci: bump GitHub Actions till senaste";
    expect(normalizeSubject(s)).toBe(s);
  });

  it("lämnar text utan conventional-huvud orörd", () => {
    // Merge-commits och liknande — vi ska inte förvanska dem.
    expect(normalizeSubject("Merge branch 'main' into foo")).toBe("Merge branch 'main' into foo");
    expect(normalizeSubject("")).toBe("");
  });

  it("hanterar huvud utan beskrivning utan att krascha", () => {
    expect(normalizeSubject("ci:")).toBe("ci:");
    expect(normalizeSubject("ci: ")).toBe("ci: ");
  });

  it("är idempotent — andra körningen ändrar inget (annars loopar workflowen)", () => {
    const once = normalizeSubject("ci: Bump foo");
    expect(normalizeSubject(once)).toBe(once);
    expect(needsNormalizing(once)).toBe(false);
  });
});

describe("needsNormalizing", () => {
  it("är sant bara när en ändring faktiskt behövs", () => {
    expect(needsNormalizing("ci: Bump foo")).toBe(true);
    expect(needsNormalizing("ci: bump foo")).toBe(false);
    expect(needsNormalizing("ci: SHA-pinna foo")).toBe(false);
  });
});
