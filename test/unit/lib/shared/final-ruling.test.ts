/**
 * Slutligt avgörande ur dokumenttext (#2099): HD:s och HFD:s domar, deras
 * beslut att inte meddela prövningstillstånd, och avskrivning. Texterna följer
 * uppställningen i publicerade avgöranden; namn och målnummer är påhittade.
 *
 * Lika viktigt som träffarna är det som INTE ska träffa: hovrättens och
 * kammarrättens avgöranden nämner HD, HFD och prövningstillstånd i
 * överklagandehänvisningen, och det får aldrig räcka.
 */

import { describe, it, expect } from "vitest-compat";
import { detectFinalRuling, normalizeRulingText } from "@/lib/shared/final-ruling";

const HD_DOM = [
  "HÖGSTA DOMSTOLENS",
  "DOM",
  "Mål nr T 1247-23",
  "meddelad i Stockholm den 14 mars 2024",
  "KLAGANDE",
  "Exempel Bygg AB",
  "ÖVERKLAGAT AVGÖRANDE",
  "Svea hovrätts dom 2023-02-01 i mål T 5555-22",
  "DOMSLUT",
  "Högsta domstolen fastställer hovrättens domslut.",
].join("\n");

const HFD_DOM = [
  "HÖGSTA FÖRVALTNINGS-",
  "DOMSTOLENS DOM",
  "Mål nr 4321-23",
  "meddelad i Stockholm den 2 maj 2024",
  "ÖVERKLAGAT AVGÖRANDE",
  "Kammarrätten i Göteborgs dom den 10 januari 2023 i mål nr 999-22",
  "SAKEN",
  "Inkomsttaxering",
].join("\n");

const HD_PT = [
  "HÖGSTA DOMSTOLEN PROTOKOLL",
  "Mål nr B 2020-24",
  "ÖVERKLAGAT AVGÖRANDE",
  "Hovrätten för Västra Sveriges dom 2024-01-15 i mål B 1111-23",
  "BESLUT",
  "Högsta domstolen meddelar inte prövningstillstånd. Hovrättens avgörande står därmed fast.",
].join("\n");

const HFD_PT = [
  "HÖGSTA FÖRVALTNINGSDOMSTOLEN BESLUT",
  "Mål nr 777-24",
  "ÖVERKLAGAT AVGÖRANDE",
  "Kammarrätten i Stockholms dom den 3 mars 2024 i mål nr 123-23",
  "Högsta förvaltningsdomstolen meddelar inte prövnings-",
  "tillstånd. Kammarrättens avgörande står därmed fast.",
].join("\n");

const HOVRATT_DOM = [
  "SVEA HOVRÄTT DOM",
  "Mål nr T 5555-22",
  "meddelad i Stockholm den 1 februari 2023",
  "DOMSLUT",
  "Hovrätten fastställer tingsrättens domslut.",
  "HUR MAN ÖVERKLAGAR",
  "För att överklagandet ska kunna prövas krävs att Högsta domstolen meddelar prövningstillstånd.",
  "Om Högsta domstolen inte meddelar prövningstillstånd står hovrättens avgörande fast.",
].join("\n");

const KAMMARRATT_BESLUT = [
  "KAMMARRÄTTEN I GÖTEBORG BESLUT",
  "Mål nr 999-22",
  "Om Högsta förvaltningsdomstolen inte meddelar prövningstillstånd står kammarrättens avgörande fast.",
].join("\n");

describe("normalizeRulingText", () => {
  it("slår ihop avstavning vid radslut och gör blanktecken till ett mellanslag", () => {
    expect(normalizeRulingText("hand-\r\n  läggning \t  här")).toBe("handläggning här");
  });

  it("låter en radbrytning före versal stå kvar", () => {
    expect(normalizeRulingText("Svea hovrätt-\nTingsrätten")).toBe("Svea hovrätt-\nTingsrätten");
  });
});

describe("detectFinalRuling: träffar", () => {
  it("HD:s dom med rubriken på flera rader och målnummer före 'meddelad i Stockholm'", () => {
    expect(detectFinalRuling(HD_DOM)).toBe("DOM_HD");
  });

  it("HD:s dom utan målnummer i rubriken", () => {
    expect(detectFinalRuling("Högsta domstolens dom meddelad i Stockholm den 1 juni 2024")).toBe("DOM_HD");
  });

  it("HFD:s dom, också med avstavat domstolsnamn", () => {
    expect(detectFinalRuling(HFD_DOM)).toBe("DOM_HFD");
  });

  it("HD:s protokoll som inte meddelar prövningstillstånd", () => {
    expect(detectFinalRuling(HD_PT)).toBe("PT_HD");
  });

  it("HFD:s beslut som inte meddelar prövningstillstånd, med avstavning", () => {
    expect(detectFinalRuling(HFD_PT)).toBe("PT_HFD");
  });

  it("avskrivning i passiv form", () => {
    expect(detectFinalRuling("BESLUT\nMålet avskrivs från vidare handläggning.")).toBe("AVSKRIVNING");
  });

  it("ärendet avskrivs, sist i texten", () => {
    expect(detectFinalRuling("Sökanden har återkallat ansökan. Ärendet avskrivs från vidare handläggning"))
      .toBe("AVSKRIVNING");
  });

  it("'Förvaltningsrätten avskriver målet …' med radbrytning och avstavning", () => {
    const text = "SKÄL\nKlaganden har återkallat.\nFörvaltningsrätten avskriver målet från vidare hand-\nläggning.";
    expect(detectFinalRuling(text)).toBe("AVSKRIVNING");
  });

  it("avskrivning efter punktnummer, följd av en ny rad med versal", () => {
    const text = "DOMSLUT\n1. Målet avskrivs från vidare handläggning\n2. Vardera parten står sin rättegångskostnad.";
    expect(detectFinalRuling(text)).toBe("AVSKRIVNING");
  });

  it("avskrivning efter kolon", () => {
    expect(detectFinalRuling("Beslut: målet avskrivs från vidare handläggning.")).toBe("AVSKRIVNING");
  });

  it("HD:s dom går före en avskrivning i samma text (reglernas ordning)", () => {
    expect(detectFinalRuling(`${HD_DOM}\nMålet avskrivs från vidare handläggning.`)).toBe("DOM_HD");
  });
});

describe("detectFinalRuling: inga träffar", () => {
  it("hovrättens dom med HD i överklagandehänvisningen", () => {
    expect(detectFinalRuling(HOVRATT_DOM)).toBeNull();
  });

  it("kammarrättens beslut med HFD i hänvisningen", () => {
    expect(detectFinalRuling(KAMMARRATT_BESLUT)).toBeNull();
  });

  it("hovrättens egen vägran att meddela prövningstillstånd", () => {
    const text = [
      "Hovrätten meddelar inte prövningstillstånd. Tingsrättens avgörande står därmed fast.",
      "Om Högsta domstolen inte meddelar prövningstillstånd står hovrättens beslut fast.",
    ].join("\n");
    expect(detectFinalRuling(text)).toBeNull();
  });

  it("ett delvis beviljat prövningstillstånd i HD", () => {
    const text = [
      "Högsta domstolen meddelar prövningstillstånd i fråga om påföljd.",
      "Högsta domstolen meddelar inte prövningstillstånd i övrigt. Hovrättens avgörande står därmed fast i den delen.",
    ].join("\n");
    expect(detectFinalRuling(text)).toBeNull();
  });

  it("HD:s vägran utan att avgörandet 'står därmed fast'", () => {
    expect(detectFinalRuling("Högsta domstolen meddelar inte prövningstillstånd.")).toBeNull();
  });

  it("en hovrättsdom som citerar 'Högsta domstolens dom den … i mål …'", () => {
    const text = "Hovrätten hänvisar till Högsta domstolens dom den 3 april 2019 i mål T 100-18, meddelad i Stockholm.";
    expect(detectFinalRuling(text)).toBeNull();
  });

  it("ett överklagande till Högsta domstolen", () => {
    const text = "Överklagande till Högsta domstolen\nJag yrkar att Högsta domstolen meddelar prövningstillstånd.";
    expect(detectFinalRuling(text)).toBeNull();
  });

  it("en begäran om avskrivning mitt i en mening", () => {
    expect(detectFinalRuling("Jag begär att målet avskrivs från vidare handläggning.")).toBeNull();
  });

  it("en radbrytning mitt i meningen gör den inte till en ny mening", () => {
    expect(detectFinalRuling("Jag begär att\nmålet avskrivs från vidare handläggning.")).toBeNull();
  });

  it("en avskrivning bara i en del", () => {
    expect(detectFinalRuling("Målet avskrivs från vidare handläggning i den del som avser skadestånd.")).toBeNull();
  });

  it("en avskrivning som bara kan komma", () => {
    expect(detectFinalRuling("Målet kan komma att avskrivas från vidare handläggning.")).toBeNull();
  });

  it("tom text", () => {
    expect(detectFinalRuling("")).toBeNull();
  });
});
