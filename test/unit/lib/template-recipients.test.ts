import { describe, it, expect } from "vitest-compat";
import {
  resolveRecipients,
  buildGeneratedFileName,
  RecipientNotLinkedError,
  type MatterContactLink,
} from "@/lib/client/template-recipients";

function link(overrides: Partial<MatterContactLink> & { contactId: string }): MatterContactLink {
  return {
    contactId: overrides.contactId,
    role: overrides.role ?? "KLIENT",
    notes: overrides.notes ?? null,
    contact: {
      name: overrides.contact?.name ?? "Anna Svensson",
      email: overrides.contact?.email ?? null,
      phone: overrides.contact?.phone ?? null,
      address: overrides.contact?.address ?? null,
      personalNumber: overrides.contact?.personalNumber ?? null,
      orgNumber: overrides.contact?.orgNumber ?? null,
    },
  };
}

// ─── resolveRecipients ───────────────────────────────────────────

describe("resolveRecipients", () => {
  it("returnerar tom lista när inga recipientIds anges", () => {
    const links = [link({ contactId: "c1" })];
    expect(resolveRecipients([], links, "m1")).toEqual([]);
  });

  it("mappar contact-id till full mottagardata med roll-label", () => {
    const links = [
      link({
        contactId: "c1",
        role: "KLIENT",
        notes: "Huvudkontakt",
        contact: { name: "Anna", email: "a@b.se", phone: null, address: "Gatan 1", personalNumber: null, orgNumber: null },
      }),
    ];
    const result = resolveRecipients(["c1"], links, "m1");
    expect(result).toEqual([
      {
        contactId: "c1",
        data: {
          name: "Anna",
          role: "KLIENT",
          roleLabel: "Klient",
          email: "a@b.se",
          phone: null,
          address: "Gatan 1",
          personalNumber: null,
          orgNumber: null,
          notes: "Huvudkontakt",
        },
      },
    ]);
  });

  it("faller tillbaka på rå roll-sträng om ingen label finns", () => {
    const links = [link({ contactId: "c1", role: "UNKNOWN_ROLE" })];
    const result = resolveRecipients(["c1"], links, "m1");
    expect(result[0]!.data.roleLabel).toBe("UNKNOWN_ROLE");
  });

  it("bevarar ordningen från recipientIds (inte från links)", () => {
    const links = [
      link({ contactId: "c1", contact: { name: "Anna", email: null, phone: null, address: null, personalNumber: null, orgNumber: null } }),
      link({ contactId: "c2", contact: { name: "Bo", email: null, phone: null, address: null, personalNumber: null, orgNumber: null } }),
      link({ contactId: "c3", contact: { name: "Cecilia", email: null, phone: null, address: null, personalNumber: null, orgNumber: null } }),
    ];

    // Begär i omvänd ordning
    const result = resolveRecipients(["c3", "c1", "c2"], links, "m1");
    expect(result.map((r) => r.data.name)).toEqual(["Cecilia", "Anna", "Bo"]);
  });

  it("kastar RecipientNotLinkedError när ID saknas i ärendet", () => {
    const links = [link({ contactId: "c1" })];
    expect(() => resolveRecipients(["c1", "c999"], links, "m42")).toThrow(RecipientNotLinkedError);
  });

  it("felet innehåller matter-id och recipient-id", () => {
    const links = [link({ contactId: "c1" })];
    try {
      resolveRecipients(["c999"], links, "m42");
      throw new Error("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(RecipientNotLinkedError);
      const err = e as RecipientNotLinkedError;
      expect(err.recipientId).toBe("c999");
      expect(err.matterId).toBe("m42");
      expect(err.message).toContain("c999");
      expect(err.message).toContain("m42");
    }
  });

  it("tillåter dubbletter i recipientIds (genererar två dokument för samma person)", () => {
    const links = [link({ contactId: "c1" })];
    const result = resolveRecipients(["c1", "c1"], links, "m1");
    expect(result).toHaveLength(2);
    expect(result[0]!.contactId).toBe("c1");
    expect(result[1]!.contactId).toBe("c1");
  });

  it("hanterar flera länkar för samma kontakt genom att ta första matchen", () => {
    // Ovanligt fall: samma kontakt med två roller i samma ärende. Vi tar bara
    // första länken vi ser — template-context har redan en flat kontakts-lista.
    const links = [
      link({ contactId: "c1", role: "KLIENT" }),
      link({ contactId: "c1", role: "VITTNE" }),
    ];
    const result = resolveRecipients(["c1"], links, "m1");
    expect(result).toHaveLength(1);
    expect(result[0]!.data.role).toBe("KLIENT");
  });
});

// ─── buildGeneratedFileName ──────────────────────────────────────

describe("buildGeneratedFileName", () => {
  it("utelämnar mottagar-suffix när recipient är null", () => {
    expect(buildGeneratedFileName("2024-0042", "Fullmakt", "pdf", null)).toBe("2024-0042 Fullmakt.pdf");
  });

  it("lägger till mottagarnamn som suffix", () => {
    const recipient = {
      name: "Anna Svensson",
      role: "KLIENT",
      roleLabel: "Klient",
      email: null,
      phone: null,
      address: null,
      personalNumber: null,
      orgNumber: null,
      notes: null,
    };
    expect(buildGeneratedFileName("2024-0042", "Fullmakt", "pdf", recipient)).toBe(
      "2024-0042 Fullmakt - Anna Svensson.pdf",
    );
  });

  it("ersätter filsystem-osäkra tecken med bindestreck", () => {
    const recipient = {
      name: "A/B AB",
      role: "KLIENT",
      roleLabel: "Klient",
      email: null,
      phone: null,
      address: null,
      personalNumber: null,
      orgNumber: null,
      notes: null,
    };
    const fn = buildGeneratedFileName("2024-0042", "Avtal: version 1", "docx", recipient);
    // Både ':' och '/' ska ha bytts mot '-'
    expect(fn).not.toContain(":");
    expect(fn).not.toContain("/");
    expect(fn).toContain("A-B AB");
    expect(fn.endsWith(".docx")).toBe(true);
  });

  it("sätter rätt filändelse", () => {
    expect(buildGeneratedFileName("2024-0001", "M", "pdf", null).endsWith(".pdf")).toBe(true);
    expect(buildGeneratedFileName("2024-0001", "M", "docx", null).endsWith(".docx")).toBe(true);
  });
});
