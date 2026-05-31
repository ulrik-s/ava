/**
 * `uuidv5(name, namespace)` är deterministisk namnbaserad UUID enligt
 * RFC 9562 §5.5. Seed-data:n behöver det för att samma slug ska producera
 * samma UUID över bygges — så att URL:er, fil-paths och cross-refs är
 * stabila utan att vi hårdkodar id-strängar i web-appen.
 *
 * `slugify(text)` normaliserar fritext till kebab-case ASCII — används
 * för entitet-slugs ("Anna Andersson" → "anna-andersson").
 */
import { describe, it, expect } from "vitest";
import { uuidv5, slugify, AVA_NAMESPACE } from "@/lib/shared/uuid-derive";
import { isUuid } from "@/lib/shared/uuid";

describe("uuidv5", () => {
  it("producerar giltig UUID v5 (version-bits = 5, variant = RFC4122)", () => {
    const id = uuidv5("anna-andersson", AVA_NAMESPACE);
    expect(isUuid(id)).toBe(true);
    // Version: 3:e position i 3:e gruppen ska vara "5"
    expect(id.charAt(14)).toBe("5");
    // Variant: 1:a position i 4:e gruppen ska vara 8/9/a/b
    expect(["8", "9", "a", "b"]).toContain(id.charAt(19));
  });

  it("är deterministisk — samma input ger samma UUID", () => {
    const a = uuidv5("contact-1", AVA_NAMESPACE);
    const b = uuidv5("contact-1", AVA_NAMESPACE);
    expect(a).toBe(b);
  });

  it("olika namn ger olika UUID:n", () => {
    const a = uuidv5("anna", AVA_NAMESPACE);
    const b = uuidv5("björn", AVA_NAMESPACE);
    expect(a).not.toBe(b);
  });

  it("olika namespaces ger olika UUID:n för samma namn", () => {
    const a = uuidv5("anna", AVA_NAMESPACE);
    const b = uuidv5("anna", "00000000-0000-0000-0000-000000000000");
    expect(a).not.toBe(b);
  });

  it("matchar känd test-vektor (RFC 9562 Appendix A.4)", () => {
    // Namespace DNS = 6ba7b810-9dad-11d1-80b4-00c04fd430c8, namn "www.example.com"
    const dnsNs = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
    const result = uuidv5("www.example.com", dnsNs);
    expect(result).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
  });
});

describe("slugify", () => {
  it("konverterar mellanslag till bindestreck", () => {
    expect(slugify("Anna Andersson")).toBe("anna-andersson");
  });

  it("transliterar svenska tecken (å/ä/ö)", () => {
    expect(slugify("Åke Östergård")).toBe("ake-ostergard");
  });

  it("tar bort interpunktion", () => {
    expect(slugify("Trygg-Hansa AB!")).toBe("trygg-hansa-ab");
  });

  it("kollapsar upprepade bindestreck", () => {
    expect(slugify("BRF  Eken --  Bostad")).toBe("brf-eken-bostad");
  });

  it("trimmar bindestreck i början och slut", () => {
    expect(slugify("-Anna-")).toBe("anna");
  });

  it("hanterar tom sträng", () => {
    expect(slugify("")).toBe("");
  });

  it("är stabil för redan-slug:ad input", () => {
    expect(slugify("anna-andersson")).toBe("anna-andersson");
  });
});

describe("AVA_NAMESPACE", () => {
  it("är en giltig UUID", () => {
    expect(isUuid(AVA_NAMESPACE)).toBe(true);
  });
});
