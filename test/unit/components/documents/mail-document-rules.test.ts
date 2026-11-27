/**
 * Maila dokument (#1951): mottagarregeln, adressfältet, storleksspärren och ämnet.
 */

import { describe, it, expect } from "vitest-compat";
import {
  clientRecipients, fitsMailAttachment, hasValidRecipients, MAIL_ATTACHMENT_MAX_BYTES, mailSubject, parseRecipients,
} from "@/components/documents/_mail-document-rules";

describe("clientRecipients", () => {
  it("bara KLIENT med e-post, i ärendets ordning", () => {
    expect(clientRecipients([
      { role: "MOTPART", contact: { email: "motpart@example.se" } },
      { role: "KLIENT", contact: { email: " b@example.se " } },
      { role: "OMBUD", contact: { email: "ombud@example.se" } },
      { role: "KLIENT", contact: { email: null } },
      { role: "KLIENT", contact: null },
      { role: "KLIENT", contact: { email: "a@example.se" } },
    ])).toEqual(["b@example.se", "a@example.se"]);
  });

  it("ingen klient med e-post (eller inga parter) ger tomt", () => {
    expect(clientRecipients([{ role: "MOTPART", contact: { email: "m@example.se" } }, { role: "KLIENT", contact: { email: "" } }])).toEqual([]);
    expect(clientRecipients(undefined)).toEqual([]);
  });
});

describe("parseRecipients och hasValidRecipients", () => {
  it("delar på komma och semikolon och tar bort tomma", () => {
    expect(parseRecipients(" a@example.se, b@example.se; ,")).toEqual(["a@example.se", "b@example.se"]);
    expect(parseRecipients("")).toEqual([]);
  });

  it("kräver minst en adress, och att alla är giltiga", () => {
    expect(hasValidRecipients(["a@example.se", "b@example.se"])).toBe(true);
    expect(hasValidRecipients([])).toBe(false);
    expect(hasValidRecipients(["a@example.se", "inte-en-adress"])).toBe(false);
  });
});

describe("fitsMailAttachment", () => {
  it("3 MB är gränsen: precis på den och en byte under går, en byte över inte", () => {
    expect(MAIL_ATTACHMENT_MAX_BYTES).toBe(3 * 1024 * 1024);
    expect(fitsMailAttachment(MAIL_ATTACHMENT_MAX_BYTES)).toBe(true);
    expect(fitsMailAttachment(MAIL_ATTACHMENT_MAX_BYTES - 1)).toBe(true);
    expect(fitsMailAttachment(MAIL_ATTACHMENT_MAX_BYTES + 1)).toBe(false);
  });
});

describe("mailSubject", () => {
  it("titeln, annars filnamnet", () => {
    expect(mailSubject({ title: "Stämningsansökan", fileName: "stamning.pdf" })).toBe("Stämningsansökan");
    expect(mailSubject({ title: "  ", fileName: "stamning.pdf" })).toBe("stamning.pdf");
    expect(mailSubject({ title: null, fileName: "stamning.pdf" })).toBe("stamning.pdf");
  });
});
