/**
 * Fakturans brevhuvud och sidfot i vy-modellen (#2255; intag #149/#150):
 * fönsteradressen, klienten, förfallodagen och byråns sidfotsuppgifter.
 */
import { describe, it, expect } from "vitest-compat";
import { buildLetterFields, postalAddressLines } from "@/lib/client/kostnadsrakning/faktura-letter-view";
import { orgImageSchema } from "@/lib/shared/org-image";

const SEAL = orgImageSchema.parse("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");

describe("postalAddressLines", () => {
  it("radbrytningar gäller; annars delar komman; tomma delar bort", () => {
    expect(postalAddressLines("Exempelgatan 1\n123 45 Exempelstad")).toEqual(["Exempelgatan 1", "123 45 Exempelstad"]);
    expect(postalAddressLines("Exempelgatan 1, 123 45 Exempelstad")).toEqual(["Exempelgatan 1", "123 45 Exempelstad"]);
    expect(postalAddressLines("Box 1\r\n\r\n111 11 Ort ")).toEqual(["Box 1", "111 11 Ort"]);
    expect(postalAddressLines("Box 1, , 111 11 Ort")).toEqual(["Box 1", "111 11 Ort"]);
    expect(postalAddressLines(null)).toEqual([]);
    expect(postalAddressLines(undefined)).toEqual([]);
  });
});

describe("buildLetterFields", () => {
  it("mottagare + adress i fönstret, klient, förfallodag och byråns sidfot", () => {
    const f = buildLetterFields({ amount: 100_000, dueDate: "2026-07-30" }, "Kalle Klientsson", {
      clientName: "Kalle Klientsson", recipientAddress: "Exempelgatan 1\n123 45 Exempelstad",
      organizationOrgNumber: "556677-8899", organizationPhone: "08-123 456 78", organizationWebsite: "https://www.exempel.se/",
      organizationBankgiro: "123-4567", organizationFooterSeal: SEAL,
    });
    expect(f).toEqual({
      recipientLines: ["Kalle Klientsson", "Exempelgatan 1", "123 45 Exempelstad"], clientName: "Kalle Klientsson", dueDate: "2026-07-30",
      payable: true, organizationPhone: "08-123 456 78", organizationWebsite: "www.exempel.se", organizationBankgiro: "123-4567",
      organizationVatNumber: "SE556677889901", footerSeal: SEAL,
    });
  });

  it("utan uppgifter: tomma fält, inget sigill; en kredit (belopp ≤ 0) betalas inte", () => {
    expect(buildLetterFields({ amount: -5_000, dueDate: null }, "", {})).toEqual({
      recipientLines: [], clientName: "", dueDate: "", payable: false, organizationPhone: "", organizationWebsite: "",
      organizationBankgiro: "", organizationVatNumber: "", footerSeal: null,
    });
  });
});
