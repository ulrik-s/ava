import { describe, it, expect } from "vitest";
import { buildIcs, fmtUtc, fmtDate, escapeText, safeFilename } from "@/app/api/events/[id]/ics/route";

// ─── Helpers ─────────────────────────────────────────────────────

const DOC = {
  fileName: "stamning.pdf",
  matter: { matterNumber: "2026-0001", title: "Vårdnadstvist Svensson" },
};

// ─── fmtUtc ──────────────────────────────────────────────────────

describe("fmtUtc", () => {
  it("formaterar UTC-datum enligt iCal (ingen separator, slutar på Z)", () => {
    const d = new Date("2026-05-14T09:30:00Z");
    expect(fmtUtc(d)).toBe("20260514T093000Z");
  });

  it("tar bort millisekunder", () => {
    const d = new Date("2026-05-14T09:30:00.123Z");
    expect(fmtUtc(d)).toBe("20260514T093000Z");
  });
});

describe("fmtDate", () => {
  it("formaterar rent datum som ÅÅÅÅMMDD", () => {
    expect(fmtDate(new Date("2026-05-14T00:00:00Z"))).toBe("20260514");
  });
});

// ─── escapeText ──────────────────────────────────────────────────

describe("escapeText", () => {
  it("escape-ar backslash, semikolon, komma och nyrad enligt RFC 5545", () => {
    expect(escapeText("a\\b;c,d\ne")).toBe("a\\\\b\\;c\\,d\\ne");
  });

  it("escape-ar CRLF som \\n", () => {
    expect(escapeText("rad1\r\nrad2")).toBe("rad1\\nrad2");
  });

  it("lämnar vanlig text oförändrad", () => {
    expect(escapeText("Huvudförhandling i Stockholms tingsrätt")).toBe(
      "Huvudförhandling i Stockholms tingsrätt"
    );
  });
});

// ─── safeFilename ────────────────────────────────────────────────

describe("safeFilename", () => {
  it("byter ut farliga tecken mot bindestreck", () => {
    expect(safeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe("a-b-c-d-e-f-g-h-i-j");
  });

  it("trimmar till 120 tecken", () => {
    const long = "a".repeat(200);
    expect(safeFilename(long)).toHaveLength(120);
  });

  it("lämnar normala filnamn orörda", () => {
    expect(safeFilename("2026-0001 - Huvudförhandling.ics")).toBe(
      "2026-0001 - Huvudförhandling.ics"
    );
  });
});

// ─── buildIcs ────────────────────────────────────────────────────

describe("buildIcs — heldagshändelse (all-day)", () => {
  it("använder VALUE=DATE och sätter DTEND till dagen efter", () => {
    const ics = buildIcs({
      id: "ev-1",
      title: "Förfallodatum",
      description: null,
      startAt: new Date("2026-05-14T00:00:00Z"),
      endAt: null,
      allDay: true,
      location: null,
      eventType: "Frist",
      document: DOC,
    });

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260514");
    // DTEND är exklusivt → dagen efter för heldagsevent
    expect(ics).toContain("DTEND;VALUE=DATE:20260515");
    expect(ics).not.toMatch(/DTSTART:\d/); // ej timed-format
  });

  it("använder endAt om det anges", () => {
    const ics = buildIcs({
      id: "ev-1",
      title: "Semester",
      description: null,
      startAt: new Date("2026-07-01T00:00:00Z"),
      endAt: new Date("2026-07-15T00:00:00Z"),
      allDay: true,
      location: null,
      eventType: null,
      document: DOC,
    });

    expect(ics).toContain("DTSTART;VALUE=DATE:20260701");
    expect(ics).toContain("DTEND;VALUE=DATE:20260715");
  });
});

describe("buildIcs — tidsatt händelse (timed)", () => {
  it("använder UTC-format för DTSTART/DTEND", () => {
    const ics = buildIcs({
      id: "ev-2",
      title: "Huvudförhandling",
      description: "Förhandling i mål T 123-26",
      startAt: new Date("2026-05-14T09:00:00Z"),
      endAt: new Date("2026-05-14T11:00:00Z"),
      allDay: false,
      location: "Stockholms tingsrätt, sal 5",
      eventType: "Förhandling",
      document: DOC,
    });

    expect(ics).toContain("DTSTART:20260514T090000Z");
    expect(ics).toContain("DTEND:20260514T110000Z");
    expect(ics).toContain("LOCATION:Stockholms tingsrätt\\, sal 5");
  });

  it("defaultar till 1 timmes längd om endAt saknas", () => {
    const ics = buildIcs({
      id: "ev-3",
      title: "Möte",
      description: null,
      startAt: new Date("2026-05-14T09:00:00Z"),
      endAt: null,
      allDay: false,
      location: null,
      eventType: null,
      document: DOC,
    });

    expect(ics).toContain("DTSTART:20260514T090000Z");
    expect(ics).toContain("DTEND:20260514T100000Z");
  });
});

describe("buildIcs — metadata och formatering", () => {
  it("inkluderar UID, DTSTAMP, PRODID, CALSCALE", () => {
    const ics = buildIcs({
      id: "ev-xyz",
      title: "X",
      description: null,
      startAt: new Date("2026-05-14T00:00:00Z"),
      endAt: null,
      allDay: true,
      location: null,
      eventType: null,
      document: DOC,
    });

    expect(ics).toContain("UID:ev-xyz@ava.local");
    expect(ics).toMatch(/DTSTAMP:\d{8}T\d{6}Z/);
    expect(ics).toContain("PRODID:-//AVA//Document Analysis//SV");
    expect(ics).toContain("CALSCALE:GREGORIAN");
    expect(ics).toContain("METHOD:PUBLISH");
  });

  it("lägger eventType-prefix i SUMMARY när det finns", () => {
    const ics = buildIcs({
      id: "ev-1",
      title: "Förhandling i T 1-26",
      description: null,
      startAt: new Date("2026-05-14T00:00:00Z"),
      endAt: null,
      allDay: true,
      location: null,
      eventType: "Förhandling",
      document: DOC,
    });

    expect(ics).toContain("SUMMARY:Förhandling: Förhandling i T 1-26");
  });

  it("utelämnar eventType-prefix när eventType är null", () => {
    const ics = buildIcs({
      id: "ev-1",
      title: "Bara titel",
      description: null,
      startAt: new Date("2026-05-14T00:00:00Z"),
      endAt: null,
      allDay: true,
      location: null,
      eventType: null,
      document: DOC,
    });

    expect(ics).toContain("SUMMARY:Bara titel");
    expect(ics).not.toMatch(/SUMMARY:[^:]+: /);
  });

  it("bygger DESCRIPTION med ärendenr och källdokument", () => {
    const ics = buildIcs({
      id: "ev-1",
      title: "X",
      description: "Svaromål ska inges",
      startAt: new Date("2026-05-14T00:00:00Z"),
      endAt: null,
      allDay: true,
      location: null,
      eventType: null,
      document: DOC,
    });

    expect(ics).toMatch(/DESCRIPTION:.*Svaromål ska inges/);
    expect(ics).toMatch(/DESCRIPTION:.*2026-0001/);
    expect(ics).toMatch(/DESCRIPTION:.*Vårdnadstvist Svensson/);
    expect(ics).toMatch(/DESCRIPTION:.*stamning\.pdf/);
  });

  it("utelämnar LOCATION-rad när location saknas", () => {
    const ics = buildIcs({
      id: "ev-1",
      title: "X",
      description: null,
      startAt: new Date("2026-05-14T00:00:00Z"),
      endAt: null,
      allDay: true,
      location: null,
      eventType: null,
      document: DOC,
    });

    expect(ics).not.toContain("LOCATION:");
  });

  it("separerar rader med CRLF enligt RFC 5545", () => {
    const ics = buildIcs({
      id: "ev-1",
      title: "X",
      description: null,
      startAt: new Date("2026-05-14T00:00:00Z"),
      endAt: null,
      allDay: true,
      location: null,
      eventType: null,
      document: DOC,
    });

    expect(ics).toContain("\r\n");
    expect(ics.endsWith("\r\n")).toBe(true);
  });

  it("escape-ar specialtecken i SUMMARY/DESCRIPTION/LOCATION", () => {
    const ics = buildIcs({
      id: "ev-1",
      title: "Titel; med, specialtecken",
      description: "Rad1\nRad2",
      startAt: new Date("2026-05-14T00:00:00Z"),
      endAt: null,
      allDay: true,
      location: "Sal 5; våning 3",
      eventType: null,
      document: DOC,
    });

    expect(ics).toContain("SUMMARY:Titel\\; med\\, specialtecken");
    expect(ics).toContain("LOCATION:Sal 5\\; våning 3");
    expect(ics).toMatch(/DESCRIPTION:.*Rad1\\nRad2/);
  });
});
