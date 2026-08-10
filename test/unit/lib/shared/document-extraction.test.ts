/**
 * Extraktion av parter och händelser ur dokumenttext (#988).
 *
 * Heuristiken är medvetet försiktig: ett förslag är en rad någon ska godkänna
 * eller avfärda med ett klick, så en falsk positiv kostar ett avfärdande medan
 * en falsk negativ bara kostar det vi redan hade (inget förslag alls). Testerna
 * nedan vaktar båda riktningarna — att markörerna hittas, OCH att löptext utan
 * markör lämnas ifred.
 */

import { describe, it, expect } from "vitest-compat";
import { extractEventSuggestions, extractPartySuggestions } from "@/lib/shared/document-extraction";

describe("extractPartySuggestions", () => {
  it("plockar roll, namn och personnummer ur ett partsblock", () => {
    const [p] = extractPartySuggestions("Kärande: Anna Andersson 850312-4567");
    expect(p).toMatchObject({
      name: "Anna Andersson", role: "KLIENT", contactType: "PERSON",
      personalNumber: "850312-4567", orgNumber: null,
    });
  });

  it("skiljer organisationsnummer från personnummer på TREDJE siffran", () => {
    // I ett personnummer är siffra 3–4 månaden (01–12) → siffra 3 är 0 eller 1.
    // Ett organisationsnummer har alltid ≥ 2 där. Det är den officiella regeln
    // och gör grupperna disjunkta utan checksumma.
    const [company] = extractPartySuggestions("Svarande: Byggfirma Stenhammar AB 556677-8899");
    expect(company).toMatchObject({ orgNumber: "556677-8899", personalNumber: null, contactType: "COMPANY" });

    const [person] = extractPartySuggestions("Svarande: Karl Nilsson 720801-1234");
    expect(person).toMatchObject({ personalNumber: "720801-1234", orgNumber: null, contactType: "PERSON" });
  });

  it("mer specifika rollord vinner — 'Motpartens ombud' är inte 'Motpart'", () => {
    const [p] = extractPartySuggestions("Motpartens ombud: Advokat Sofia Grip");
    expect(p?.role).toBe("MOTPARTSOMBUD");
    expect(p?.contactType).toBe("LAW_FIRM");
  });

  it("rollordet får stå på raden FÖRE namnet", () => {
    const [p] = extractPartySuggestions("Svarande\nByggfirma Stenhammar AB");
    expect(p).toMatchObject({ name: "Byggfirma Stenhammar AB", role: "MOTPART" });
  });

  it("samma part i samma roll föreslås EN gång, hur ofta den än nämns", () => {
    const text = [
      "Kärande: Anna Andersson 850312-4567",
      "Käranden yrkar ersättning.",
      "Kärande: Anna Andersson 850312-4567",
    ].join("\n");
    expect(extractPartySuggestions(text)).toHaveLength(1);
  });

  it("löptext utan rollord ger INGA förslag", () => {
    // Det viktiga negativa fallet: heuristiken får inte gissa namn ur prosa.
    const text = "Parterna har diskuterat förlikning under våren och nått viss enighet.";
    expect(extractPartySuggestions(text)).toEqual([]);
  });

  it("rollord utan rimligt namn ger inget förslag", () => {
    // "Käranden yrkar att tingsrätten förpliktar svaranden att utge skadestånd"
    // är en mening, inte ett namn — för många ord.
    const text = "Käranden yrkar att tingsrätten förpliktar svaranden att utge skadestånd";
    expect(extractPartySuggestions(text)).toEqual([]);
  });

  it("domstol och försäkringsbolag får sina egna kontakttyper", () => {
    expect(extractPartySuggestions("Stockholms tingsrätt")[0]).toMatchObject({ role: "DOMSTOL", contactType: "COURT" });
    expect(extractPartySuggestions("Försäkringsbolag: Folksam")[0]).toMatchObject({ contactType: "INSURANCE_COMPANY" });
  });

  it("bär med sig raden som motivering — den som godkänner ska se varifrån", () => {
    const [p] = extractPartySuggestions("Vittne: Karl Nilsson 720801-1234");
    expect(p?.notes).toContain("Vittne: Karl Nilsson");
  });
});

describe("extractEventSuggestions", () => {
  it("läser ISO-datum och klockslag ur en kallelse", () => {
    const [e] = extractEventSuggestions("Muntlig förberedelse har satts ut till 2026-09-15 kl. 09.30.");
    expect(e?.title).toBe("Muntlig förberedelse");
    expect(e?.eventType).toBe("FORBEREDELSE");
    expect(e?.startAt.getFullYear()).toBe(2026);
    expect(e?.startAt.getMonth()).toBe(8); // september
    expect(e?.startAt.getDate()).toBe(15);
    expect(e?.startAt.getHours()).toBe(9);
    expect(e?.startAt.getMinutes()).toBe(30);
  });

  it("läser svensk datumform i löptext", () => {
    const [e] = extractEventSuggestions("Huvudförhandling hölls den 12 maj 2026 kl. 09.00.");
    expect(e?.title).toBe("Huvudförhandling");
    expect(e?.startAt.getMonth()).toBe(4);
    expect(e?.startAt.getDate()).toBe(12);
  });

  it("datum utan klockslag ger ändå ett förslag — kl 00.00 att bekräfta", () => {
    const [e] = extractEventSuggestions("Frist för överklagande: senast den 2026-06-02.");
    expect(e?.eventType).toBe("FRIST");
    expect(e?.startAt.getHours()).toBe(0);
  });

  it("kallelseord UTAN datum ger inget förslag", () => {
    expect(extractEventSuggestions("Huvudförhandling kommer att hållas senare i vår.")).toEqual([]);
  });

  it("datum UTAN kallelseord ger inget förslag", () => {
    // Ett datum i löptext är inte en händelse — annars hade varje handling
    // producerat brus som någon måste avfärda.
    expect(extractEventSuggestions("Avtalet undertecknades 2026-03-01.")).toEqual([]);
  });

  it("samma händelse vid samma tidpunkt föreslås en gång", () => {
    const text = [
      "Huvudförhandling 2026-05-12 kl. 09.00",
      "Huvudförhandling 2026-05-12 kl. 09.00",
    ].join("\n");
    expect(extractEventSuggestions(text)).toHaveLength(1);
  });
});

describe("hela partsblocket ur en stämningsansökan", () => {
  const STAMNING = [
    "STÄMNINGSANSÖKAN",
    "Kärande: Anna Andersson 850312-4567",
    "Ombud: Advokat Erik Lundqvist",
    "Svarande: Byggfirma Stenhammar AB 556677-8899",
    "Motpartens ombud: Advokat Sofia Grip",
    "",
    "Käranden yrkar att tingsrätten förpliktar svaranden att utge skadestånd.",
    "Muntlig förberedelse har satts ut till 2026-09-15 kl. 09.30.",
  ].join("\n");

  it("ger en part per rad i blocket, med rätt roller", () => {
    const roles = extractPartySuggestions(STAMNING).map((p) => `${p.role}:${p.name}`);
    expect(roles).toEqual([
      "KLIENT:Anna Andersson",
      "OMBUD:Advokat Erik Lundqvist",
      "MOTPART:Byggfirma Stenhammar AB",
      "MOTPARTSOMBUD:Advokat Sofia Grip",
    ]);
  });

  it("och exakt en händelse — sammanträdesraden, inte yrkanderaden", () => {
    const events = extractEventSuggestions(STAMNING);
    expect(events).toHaveLength(1);
    expect(events[0]?.title).toBe("Muntlig förberedelse");
  });
});
