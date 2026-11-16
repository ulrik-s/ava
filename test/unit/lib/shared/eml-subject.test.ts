/**
 * Ämnesraden ur en `.eml` (#1616): vikta rader, RFC 2047 encoded-words
 * (B och Q, UTF-8 och ISO-8859-1), skiftlägesokänsligt huvudnamn och att
 * funktionen aldrig kastar.
 */

import { describe, expect, it } from "vitest-compat";
import { EML_HEAD_BYTES, emlSubject, isEmlFile } from "@/lib/shared/eml-subject";

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
const subject = (text: string): string | null => emlSubject(utf8(text));

describe("emlSubject", () => {
  it("enkelt ämne", () => {
    expect(subject("From: a@b.se\r\nSubject: Hej\r\nTo: c@d.se\r\n\r\nText")).toBe("Hej");
  });

  it("LF-radslut fungerar också", () => {
    expect(subject("Subject: Möte i morgon\n\nText")).toBe("Möte i morgon");
  });

  it("foldat ämne över två rader", () => {
    expect(subject("Subject: Angående avtalet\r\n och bilagan\r\nTo: c@d.se\r\n\r\n")).toBe("Angående avtalet och bilagan");
  });

  it("Base64-kodat UTF-8 med å/ä/ö", () => {
    expect(subject("Subject: =?UTF-8?B?w6XDpMO2?=\r\n\r\n")).toBe("åäö");
  });

  it("Q-kodat UTF-8 med å/ä/ö och understreck som blanksteg", () => {
    expect(subject("Subject: =?utf-8?q?F=C3=B6rlikning_och_r=C3=A4ttsfr=C3=A5ga?=\r\n\r\n")).toBe("Förlikning och rättsfråga");
  });

  it("ISO-8859-1 i Q-kodning", () => {
    expect(subject("Subject: =?ISO-8859-1?Q?Sm=E5_=E4ndringar?=\r\n\r\n")).toBe("Små ändringar");
  });

  it("intilliggande encoded-words slås ihop utan blanksteg, vanlig text runt om behålls", () => {
    expect(subject("Subject: Re: =?UTF-8?B?w6U=?=\r\n =?UTF-8?B?w6Q=?= klart\r\n\r\n")).toBe("Re: åä klart");
  });

  it("språktaggen efter * i teckenuppsättningen (RFC 2231) ignoreras", () => {
    expect(subject("Subject: =?UTF-8*sv?Q?h=C3=A4r?=\r\n\r\n")).toBe("här");
  });

  it("`subject:` i gemener", () => {
    expect(subject("subject: liten\r\n\r\n")).toBe("liten");
  });

  it("inget Subject → null", () => {
    expect(subject("From: a@b.se\r\nTo: c@d.se\r\n\r\nText")).toBeNull();
  });

  it("tomt Subject → null", () => {
    expect(subject("Subject:   \r\nTo: c@d.se\r\n\r\n")).toBeNull();
  });

  it("`Subject:` i brödtexten efter tom rad ignoreras", () => {
    expect(subject("From: a@b.se\r\n\r\nSubject: inte detta")).toBeNull();
  });

  it("huvudnamn som bara börjar med Subject räknas inte", () => {
    expect(subject("X-Subject: nej\r\n\r\n")).toBeNull();
  });

  it("trasig Base64 → rå text, inget kast", () => {
    expect(subject("Subject: =?UTF-8?B?***?=\r\n\r\n")).toBe("=?UTF-8?B?***?=");
  });

  it("okänd teckenuppsättning → rå text, inget kast", () => {
    expect(subject("Subject: =?x-okand?Q?abc?=\r\n\r\n")).toBe("=?x-okand?Q?abc?=");
  });

  it("ogiltig UTF-8 i ett encoded-word → rå text", () => {
    expect(subject("Subject: =?UTF-8?Q?=FF?=\r\n\r\n")).toBe("=?UTF-8?Q?=FF?=");
  });

  it("8-bitars huvud som inte är UTF-8 läses som Windows-1252", () => {
    const bytes = Uint8Array.from([..."Subject: Sm".split("").map((c) => c.charCodeAt(0)), 0xe5, 0x0d, 0x0a, 0x0d, 0x0a]);
    expect(emlSubject(bytes)).toBe("Små");
  });

  it("ett UTF-8-tecken som klipps av vid läsgränsen gör inte huvudet ogiltigt", () => {
    const whole = utf8("Subject: Hälsning\r\n\r\nå");
    expect(emlSubject(whole.subarray(0, whole.length - 1))).toBe("Hälsning");
  });

  it("bara de första EML_HEAD_BYTES byten läses", () => {
    const padding = `X-Fyll: ${"a".repeat(EML_HEAD_BYTES)}\r\n`;
    expect(subject(`${padding}Subject: för sent\r\n\r\n`)).toBeNull();
  });

  it("tomma byte → null", () => {
    expect(emlSubject(new Uint8Array())).toBeNull();
  });
});

describe("isEmlFile", () => {
  it("ändelsen .eml, oavsett skiftläge", () => {
    expect(isEmlFile("mejl.eml", "")).toBe(true);
    expect(isEmlFile("MEJL.EML", "application/octet-stream")).toBe(true);
  });

  it("mimetypen message/rfc822", () => expect(isEmlFile("mejl", "message/RFC822")).toBe(true));

  it("andra filer", () => expect(isEmlFile("skiss.pdf", "application/pdf")).toBe(false));
});
