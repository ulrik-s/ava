/**
 * Dubblettskyddets id (mail-document-id.ts): samma mejl i samma ärende ger
 * alltid samma id, ett annat ärende ett annat — och id:t är ett giltigt UUID
 * (dokument-kolumnen är av typen uuid).
 */

import { describe, expect, it } from "vitest-compat";
import { mailDocumentId } from "@/lib/shared/mail-document-id";

const MSG = "<CAF0a1b2c3@mail.example.se>";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("mailDocumentId", () => {
  it("är ett UUID (version 8, RFC 9562-variant)", async () => {
    expect(await mailDocumentId("m1", MSG)).toMatch(UUID);
  });

  it("samma mejl + samma ärende → samma id (även med blanktecken runt)", async () => {
    expect(await mailDocumentId("m1", MSG)).toBe(await mailDocumentId("m1", `  ${MSG}\n`));
  });

  it("annat ärende eller annat mejl → annat id", async () => {
    const base = await mailDocumentId("m1", MSG);
    expect(await mailDocumentId("m2", MSG)).not.toBe(base);
    expect(await mailDocumentId("m1", "<annat@mail.example.se>")).not.toBe(base);
  });
});
