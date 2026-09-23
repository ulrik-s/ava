/**
 * Maskeringen (#1080).
 *
 * Testerna är skrivna som påståenden om SEKRETESS, inte om reguljära uttryck.
 * Advokatsekretessen gäller uppgiften om att någon är klient — en logg som
 * avslöjar att `19670312-4521` finns i systemet har redan läckt det, oavsett
 * vad som står runt omkring.
 *
 * Personnumren nedan är påhittade.
 */

import { describe, it, expect } from "vitest-compat";
import { errorMessage, redactMessage, redactText } from "@/lib/shared/observability/redact";

describe("personnummer", () => {
  it.each([
    ["tolvsiffrigt med bindestreck", "19670312-4521"],
    ["tiosiffrigt med bindestreck", "670312-4521"],
    ["samordningsnummer med plus", "670312+4521"],
    ["utan separator", "196703124521"],
    ["tiosiffrigt utan separator", "6703124521"],
  ])("maskerar %s", (_label, pnr) => {
    expect(redactText(`Klienten ${pnr} saknar fullmakt`)).not.toContain(pnr);
  });

  it("säger VAD som maskerades — annars går felet inte att felsöka", () => {
    expect(redactText("19670312-4521")).toContain("personnummer");
  });

  it("maskerar flera i samma text", () => {
    const out = redactText("Jäv mellan 19670312-4521 och 19720815-3312");
    expect(out).not.toContain("4521");
    expect(out).not.toContain("3312");
  });

  // Ordgränserna finns för att inte kapa id:n mitt itu. Ett fakturanummer
  // eller ett OCR ska överleva — de är interna referenser, inte identiteter,
  // och de är ofta det enda som gör felet sökbart.
  it("rör inte ett fakturanummer", () => {
    expect(redactText("Faktura F-2026-0042 saknar OCR")).toContain("F-2026-0042");
  });
});

describe("e-post", () => {
  it("maskerar adressen", () => {
    expect(redactText("skickat till anna@byra.se")).not.toContain("anna@byra.se");
  });

  it("maskerar även i vinkelparenteser", () => {
    expect(redactText("<anna.andersson@advokat.example>")).not.toContain("anna.andersson");
  });
});

describe("åtkomsthemligheter", () => {
  // De här läcker inte sekretess utan ÅTKOMST: en loggrad som klistras in i
  // en supporttråd blir en nyckel.
  it("maskerar Bearer-token", () => {
    expect(redactText("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc")).not.toContain("eyJhbGci");
  });

  it("maskerar lång hex — refresh-token-formen", () => {
    const token = "0f98544050474a7446b08932083bb72a5809cf88";
    expect(redactText(`token=${token}`)).not.toContain(token);
  });

  it("maskerar token FÖRE personnummer — annars kapas token på mitten", () => {
    // En hex-token kan innehålla tolv siffror i rad. Körs personnummer-mönstret
    // först maskeras den biten och RESTEN av token:en lämnas i klartext.
    const token = "a196703124521bcdef0123456789abcdef012345";
    const out = redactText(`token=${token}`);
    expect(out).not.toContain("0123456789");
  });
});

describe("telefon", () => {
  it("maskerar svenskt mobilnummer", () => {
    expect(redactText("nås på 070-123 45 67")).not.toContain("123 45 67");
  });
});

describe("redactMessage", () => {
  it("kortar långa meddelanden", () => {
    const long = "x".repeat(500);
    expect(redactMessage(long).length).toBeLessThan(400);
  });

  // Längdtaket är inte kosmetika: utan det kan en hel JSON-payload resa med
  // som text, och då är strukturskyddet verkningslöst.
  it("markerar att det kortades", () => {
    expect(redactMessage("x".repeat(500))).toContain("…");
  });

  it("lämnar korta meddelanden orörda", () => {
    expect(redactMessage("Ärendet saknar betalningssätt")).toBe("Ärendet saknar betalningssätt");
  });

  it("maskerar innan den kortar — inte tvärtom", () => {
    const msg = `${"x".repeat(290)} 19670312-4521`;
    expect(redactMessage(msg)).not.toContain("19670312");
  });
});

describe("errorMessage", () => {
  it("plockar meddelandet ur ett Error och maskerar det", () => {
    expect(errorMessage(new Error("Klient 19670312-4521 saknas"))).not.toContain("19670312");
  });

  it("tar en sträng lika väl", () => {
    expect(errorMessage("anna@byra.se svarade inte")).not.toContain("anna@byra.se");
  });

  // JS kastar vad som helst. Att anropsplatsen ska behöva veta det är fel
  // ställe att lägga ansvaret.
  it.each([[null], [undefined], [42], [{ a: 1 }]])("ger en text för %p", (thrown) => {
    expect(typeof errorMessage(thrown)).toBe("string");
  });
});
