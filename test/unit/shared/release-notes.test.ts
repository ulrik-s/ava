/**
 * "Nytt i AVA" (#2010): PR:ens rad för användarna, releasens avsnitt och
 * vilka versioner användaren inte sett.
 */
import { describe, expect, it } from "vitest-compat";
import {
  extractUserNotes, MAX_UNSEEN_RELEASES, parseVersion, RELEASE_NOTES_HEADING, type ReleaseNote, releaseSection, unseenReleases, userNoteOf,
} from "@/lib/shared/release-notes";

describe("userNoteOf", () => {
  it("läser raden, och ett streck eller en tom rad betyder att inget syns", () => {
    expect(userNoteOf("Vad som ändrats.\n\n**För användarna:** Dokumentlistan visar inte längre Storlek.\n\nCloses #1")).toBe("Dokumentlistan visar inte längre Storlek.");
    expect(userNoteOf("  **För användarna:**   Ny knapp.  ")).toBe("Ny knapp.");
    expect(userNoteOf("**För användarna:** —")).toBeNull();
    expect(userNoteOf("**För användarna:** -")).toBeNull();
    expect(userNoteOf("**För användarna:**")).toBeNull();
    expect(userNoteOf("Ingen rad alls.")).toBeNull();
  });
});

describe("releaseSection och extractUserNotes", () => {
  it("avsnittet går fram och tillbaka; utan rader blir det tomt", () => {
    const section = releaseSection(["Ny knapp.", "Rättad summa."]);
    expect(section.startsWith(RELEASE_NOTES_HEADING)).toBe(true);
    expect(extractUserNotes(`AVA v1 — hela paketet.\n\n- **Web** — demo\n\n${section}\n## What's Changed\n* fix: x`)).toEqual(["Ny knapp.", "Rättad summa."]);
    expect(releaseSection([])).toBe("");
  });

  it("utan rubrik finns inga nyheter; till slutet om ingen ny rubrik följer; CRLF går bra", () => {
    expect(extractUserNotes("- **Web** — demo")).toEqual([]);
    expect(extractUserNotes(`${RELEASE_NOTES_HEADING}\r\n\r\n- A\r\n- B`)).toEqual(["A", "B"]);
  });
});

describe("parseVersion", () => {
  it("taggar och byggen mellan taggar; annat är null", () => {
    expect(parseVersion("v0.7.54")).toEqual([0, 7, 54]);
    expect(parseVersion("0.7.54-3-gabc1234")).toEqual([0, 7, 54]);
    expect(parseVersion("main")).toBeNull();
  });
});

describe("unseenReleases", () => {
  const note = (version: string): ReleaseNote => ({ version, date: "2026-11-22T10:00:00Z", items: [`nytt i ${version}`] });
  const notes = [note("v0.7.56"), note("v0.7.55"), note("v0.7.54"), note("v0.7.52"), note("trasig")];

  it("nyare än den sedda och inte nyare än den som kör, nyast först", () => {
    expect(unseenReleases(notes, "v0.7.52", "v0.7.55").map((n) => n.version)).toEqual(["v0.7.55", "v0.7.54"]);
    expect(unseenReleases(notes, "v0.7.55", "v0.7.55")).toEqual([]);
  });

  it("aldrig sett: bara versionen som kör; okänd version som kör: inget", () => {
    expect(unseenReleases(notes, null, "v0.7.54-2-gabc").map((n) => n.version)).toEqual(["v0.7.54"]);
    expect(unseenReleases(notes, null, "v0.7.53")).toEqual([]);
    expect(unseenReleases(notes, null, "")).toEqual([]);
    expect(unseenReleases(notes, "skräp", "v0.7.55").map((n) => n.version)).toEqual(["v0.7.55"]);
  });

  it("högst fem versioner", () => {
    const many = Array.from({ length: 8 }, (_, i) => note(`v1.0.${i}`));
    expect(unseenReleases(many, "v0.9.0", "v1.0.7")).toHaveLength(MAX_UNSEEN_RELEASES);
  });
});
