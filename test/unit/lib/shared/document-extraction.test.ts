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

  it("'Medtilltalad' ger rollen MEDTILLTALAD, 'Tilltalad' fortfarande KLIENT (#1637)", () => {
    for (const marker of ["Medtilltalad", "Medtilltalade", "Medtilltaladen"]) {
      const [p] = extractPartySuggestions(`${marker}: Per Exempelsson`);
      expect(p).toMatchObject({ name: "Per Exempelsson", role: "MEDTILLTALAD", contactType: "PERSON" });
    }
    const [client] = extractPartySuggestions("Tilltalad: Eva Exempeldotter");
    expect(client).toMatchObject({ name: "Eva Exempeldotter", role: "KLIENT" });
  });

  it("tilltalad och medtilltalad i samma text får var sin roll, oavsett ordning", () => {
    const roles = (text: string) => extractPartySuggestions(text).map((p) => `${p.role}:${p.name}`).sort();
    const expected = ["KLIENT:Eva Exempeldotter", "MEDTILLTALAD:Per Exempelsson"];
    expect(roles("Tilltalad: Eva Exempeldotter\nMedtilltalad: Per Exempelsson")).toEqual(expected);
    expect(roles("Medtilltalad: Per Exempelsson\nTilltalad: Eva Exempeldotter")).toEqual(expected);
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

describe("förordnanden (#1648)", () => {
  const roles = (text: string): string[] =>
    extractPartySuggestions(text).map((p) => `${p.role}:${p.name}`);

  it("försvararförordnande som en enda mening → klienten som Klient med personnummer, advokaten saknas", () => {
    const text = "Tingsrätten förordnar advokaten Per Holm som offentlig försvarare för Lisa Ek, 900101-1234.";
    const parties = extractPartySuggestions(text);
    expect(parties).toHaveLength(1);
    expect(parties[0]).toMatchObject({
      name: "Lisa Ek", role: "KLIENT", contactType: "PERSON",
      personalNumber: "900101-1234", orgNumber: null,
    });
    expect(parties[0]?.notes).toContain("förordnar advokaten Per Holm");
  });

  it("målsägandebiträdesförordnande → målsäganden som Klient, advokaten saknas", () => {
    const text = "Advokaten Eva Sand förordnas som målsägandebiträde för Nils Berg.";
    expect(roles(text)).toEqual(["KLIENT:Nils Berg"]);
  });

  it("två förordnanden → första förordnandets klient som Klient; målsägandebiträdet saknas", () => {
    const text = [
      "Tingsrätten förordnar advokaten Per Holm som offentlig försvarare för Lisa Ek, 900101-1234.",
      "Advokaten Eva Sand förordnas som målsägandebiträde för Nils Berg.",
      "Målsägandebiträde: Advokat Eva Sand",
      "Ombud: Advokat Per Holm",
      "Klient: Nils Berg",
    ].join("\n");
    // Målsäganden ur målsägandebiträdesmeningen blir Motpart (#1649).
    expect(roles(text)).toEqual(["KLIENT:Lisa Ek", "MOTPART:Nils Berg"]);
  });

  it("personnumret hämtas ur partsblocket när meningen saknar det", () => {
    const text = [
      "Tilltalad: Lisa Ek 900101-1234",
      "Tingsrätten förordnar advokaten Per Holm som offentlig försvarare för Lisa Ek.",
    ].join("\n");
    const parties = extractPartySuggestions(text);
    expect(parties).toHaveLength(1);
    expect(parties[0]).toMatchObject({ name: "Lisa Ek", role: "KLIENT", personalNumber: "900101-1234" });
  });

  it("förordnande utan punkt följt av ett partsblock → klienten tar inte nästa rads namn eller nummer", () => {
    const text = [
      "Tingsrätten förordnar advokaten Per Holm som offentlig försvarare för Lisa Ek",
      "",
      "Målsägande: Nils Berg 850101-1111",
      "Tilltalad: Lisa Ek",
    ].join("\n");
    const parties = extractPartySuggestions(text);
    // Målsägande-raden är en partsrad; i ett försvararförordnande Motpart (#1649).
    expect(parties.map((p) => [p.role, p.name, p.personalNumber])).toEqual([
      ["KLIENT", "Lisa Ek", null],
      ["MOTPART", "Nils Berg", "850101-1111"],
    ]);
  });

  it("förordnande utan punkt direkt följt av en partsrad → personnumret bara ur klientens egen rad", () => {
    const text = [
      "Tingsrätten förordnar advokaten Per Holm som offentlig försvarare för Lisa Ek",
      "Målsägande: Nils Berg 850101-1111",
      "Tilltalad: Lisa Ek 900101-1234",
    ].join("\n");
    const lisa = extractPartySuggestions(text).filter((p) => p.name.startsWith("Lisa Ek"));
    expect(lisa).toHaveLength(1);
    expect(lisa[0]).toMatchObject({ name: "Lisa Ek", role: "KLIENT", personalNumber: "900101-1234" });
  });

  it("förordnande utan punkt följt av domstolens namn → klientens namn slutar vid radslutet", () => {
    const text = [
      "Tingsrätten förordnar advokaten Per Holm som offentlig försvarare för Lisa Ek",
      "Stockholms tingsrätt",
    ].join("\n");
    expect(roles(text)).toEqual(["KLIENT:Lisa Ek", "DOMSTOL:Stockholms tingsrätt"]);
  });

  it("åklagare och domstol i samma text föreslås som i dag", () => {
    const text = [
      "Stockholms tingsrätt",
      "Åklagare: Kammaråklagare Ola Lind",
      "Tingsrätten förordnar advokaten Per Holm som offentlig försvarare för Lisa Ek.",
    ].join("\n");
    expect(roles(text)).toEqual([
      "KLIENT:Lisa Ek",
      "DOMSTOL:Stockholms tingsrätt",
      "AKLAGARE:Kammaråklagare Ola Lind",
    ]);
  });

  it("ett annat förordnandes klient får behålla en roll utanför advokatens sida", () => {
    const text = [
      "Tingsrätten förordnar advokaten Per Holm som offentlig försvarare för Lisa Ek.",
      "Advokaten Eva Sand förordnas som målsägandebiträde för Nils Berg.",
      "Vittne: Nils Berg",
    ].join("\n");
    expect(roles(text)).toEqual(["KLIENT:Lisa Ek", "VITTNE:Nils Berg"]);
  });

  it("ett vanligt dokument utan förordnande ger samma förslag som tidigare", () => {
    const text = [
      "Kärande: Anna Andersson 850312-4567",
      "Ombud: Advokat Erik Lundqvist",
      "Tingsrätten har förordnat en sakkunnig.",
    ].join("\n");
    expect(roles(text)).toEqual(["KLIENT:Anna Andersson", "OMBUD:Advokat Erik Lundqvist"]);
  });
});

describe("förordnandets uppdrag avgör de andra parternas roller (#1649)", () => {
  const roles = (text: string): string[] =>
    extractPartySuggestions(text).map((p) => `${p.role}:${p.name}`);

  it("försvararförordnande med partsblock → målsägande Motpart, annan tilltalad Medtilltalad", () => {
    const text = [
      "Stockholms tingsrätt",
      "Tingsrätten förordnar advokaten Per Holm som offentlig försvarare för Lisa Ek.",
      "Advokaten Eva Sand förordnas som målsägandebiträde för Nils Berg.",
      "Åklagare: Kammaråklagare Ola Lind",
      "Tilltalad: Lisa Ek 900101-1234",
      "Tilltalad: Karl Ny 880202-2222",
      "Målsägande: Nils Berg 850101-1111",
      "Målsägandebiträde: Advokat Eva Sand",
      "Offentlig försvarare: Advokat Per Holm",
    ].join("\n");
    const parties = extractPartySuggestions(text);
    expect(parties.map((p) => `${p.role}:${p.name}`)).toEqual([
      "KLIENT:Lisa Ek",
      "DOMSTOL:Stockholms tingsrätt",
      "AKLAGARE:Kammaråklagare Ola Lind",
      "MEDTILLTALAD:Karl Ny",
      "MOTPART:Nils Berg",
    ]);
    expect(parties[0]?.personalNumber).toBe("900101-1234");
    expect(parties.find((p) => p.name === "Karl Ny")).toMatchObject({ contactType: "PERSON", personalNumber: "880202-2222" });
  });

  it("målsägandebiträdesförordnande → målsäganden Klient, alla tilltalade Motpart, försvararen saknas", () => {
    const text = [
      "Tingsrätten förordnar advokaten Eva Sand som målsägandebiträde för Nils Berg.",
      "Advokaten Per Holm förordnas som offentlig försvarare för Lisa Ek.",
      "Målsägande: Nils Berg",
      "Tilltalad: Lisa Ek",
      "Tilltalad: Karl Ny",
      "Offentlig försvarare: Advokat Per Holm",
    ].join("\n");
    expect(roles(text)).toEqual(["KLIENT:Nils Berg", "MOTPART:Lisa Ek", "MOTPART:Karl Ny"]);
  });

  it("rollen som rubrik på raden ovanför namnet ger samma roller", () => {
    const text = [
      "Tingsrätten förordnar advokaten Per Holm som offentlig försvarare för Lisa Ek.",
      "Målsägande",
      "Nils Berg",
      "Tilltalad",
      "Karl Ny",
    ].join("\n");
    expect(roles(text)).toEqual(["KLIENT:Lisa Ek", "MOTPART:Nils Berg", "MEDTILLTALAD:Karl Ny"]);
  });

  it("\"Misstänkt\" i ett försvararförordnande → Medtilltalad, eller Klient om det är klienten", () => {
    const text = [
      "Tingsrätten förordnar advokaten Per Holm som offentlig försvarare för Lisa Ek.",
      "Misstänkt: Lisa Ek",
      "Misstänkt: Karl Ny",
      "Misstänkt",
      "Olle Bo",
    ].join("\n");
    expect(roles(text)).toEqual(["KLIENT:Lisa Ek", "MEDTILLTALAD:Karl Ny", "MEDTILLTALAD:Olle Bo"]);
  });

  it("\"Misstänkt\" i ett målsägandebiträdesförordnande → Motpart", () => {
    const text = [
      "Advokaten Eva Sand förordnas som målsägandebiträde för Nils Berg.",
      "Misstänkt: Karl Ny",
    ].join("\n");
    expect(roles(text)).toEqual(["KLIENT:Nils Berg", "MOTPART:Karl Ny"]);
  });

  it("namn i förordnandemeningar får rollen ur sitt uppdrag; personnumret ur meningen", () => {
    const text = [
      "Tingsrätten förordnar advokaten Per Holm som offentlig försvarare för Lisa Ek.",
      "Advokaten Anna Vik förordnas som offentlig försvarare för Karl Ny, 880202-2222.",
      "Advokaten Eva Sand förordnas som målsägandebiträde för Nils Berg.",
      "Advokaten Ida Lund förordnas som målsägandebiträde för Nils Berg.",
    ].join("\n");
    const parties = extractPartySuggestions(text);
    expect(parties.map((p) => `${p.role}:${p.name}`)).toEqual([
      "KLIENT:Lisa Ek", "MEDTILLTALAD:Karl Ny", "MOTPART:Nils Berg",
    ]);
    expect(parties[1]).toMatchObject({ personalNumber: "880202-2222", contactType: "PERSON" });
    expect(parties[1]?.notes).toContain("förordnas som offentlig försvarare för Karl Ny");
  });

  it("partsblocket vinner över förordnandemeningen för samma namn", () => {
    const text = [
      "Tingsrätten förordnar advokaten Per Holm som offentlig försvarare för Lisa Ek.",
      "Advokaten Eva Sand förordnas som målsägandebiträde för Nils Berg.",
      "Målsägande: Nils Berg 850101-1111",
    ].join("\n");
    const parties = extractPartySuggestions(text);
    expect(parties.map((p) => `${p.role}:${p.name}`)).toEqual(["KLIENT:Lisa Ek", "MOTPART:Nils Berg"]);
    expect(parties[1]?.notes).toContain("Föreslagen ur dokumentet");
  });

  it("ett annat uppdrag än försvarare/målsägandebiträde → övriga parter som i dag", () => {
    const text = [
      "Advokaten Eva Sand har förordnats som särskild företrädare för barnet Moa Berg.",
      "Advokaten Per Holm förordnas som offentlig försvarare för Lisa Ek.",
      "Tilltalad: Karl Ny",
      "",
      "Misstänkt: Olle Bo",
    ].join("\n");
    expect(roles(text)).toEqual(["KLIENT:Moa Berg", "KLIENT:Karl Ny"]);
  });

  it("ett vanligt dokument utan förordnande: tilltalad och målsägande Klient, misstänkt ingen markör", () => {
    const text = [
      "Tilltalad: Lisa Ek",
      "Målsägande: Nils Berg",
      "",
      "Misstänkt: Karl Ny",
      "",
      "Misstänkt",
      "Olle Bo",
    ].join("\n");
    expect(roles(text)).toEqual(["KLIENT:Lisa Ek", "KLIENT:Nils Berg"]);
  });
});
