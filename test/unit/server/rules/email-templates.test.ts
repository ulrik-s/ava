import { describe, it, expect } from "vitest";
import { renderEmail } from "@/server/rules/email-templates";

describe("renderEmail", () => {
  it("generic mall returnerar subject + text från vars", () => {
    const r = renderEmail("generic", { subject: "Hej", text: "Innehåll" });
    expect(r).toEqual({ subject: "Hej", text: "Innehåll" });
  });

  it("generic mall stödjer valfri html", () => {
    const r = renderEmail("generic", { subject: "S", text: "T", html: "<p>T</p>" });
    expect(r.html).toBe("<p>T</p>");
  });

  it("generic mall kastar om subject saknas", () => {
    expect(() => renderEmail("generic", { text: "T" })).toThrow(/subject/);
  });

  it("payment-reminder bygger svensk text + bankgiro när satt", () => {
    const r = renderEmail("payment-reminder", {
      recipientEmail: "k@x.se",
      recipientName: "Anna Klient",
      matterNumber: "2026-0001",
      matterTitle: "Vårdnadstvist",
      invoiceAmount: 5000000,
      monthlyAmount: 500000,
      dayOfMonth: 25,
      remainingAmount: 4500000,
      organizationName: "Advokat AB",
      bankgiro: "123-4567",
    });
    expect(r.subject).toContain("2026-0001");
    expect(r.subject).toContain("Vårdnadstvist");
    expect(r.text).toContain("Anna Klient");
    expect(r.text).toMatch(/5\s000,00 kr/);
    expect(r.text).toContain("123-4567");
  });

  it("payment-overdue lägger PÅMINNELSE-prefix", () => {
    const r = renderEmail("payment-overdue", {
      recipientEmail: "k@x.se",
      recipientName: "A",
      matterNumber: "2026-0001",
      matterTitle: "T",
      invoiceAmount: 1000,
      monthlyAmount: 1000,
      dayOfMonth: 25,
      remainingAmount: 1000,
      organizationName: "Org",
    });
    expect(r.subject).toContain("PÅMINNELSE");
    expect(r.text).toContain("mer än 10 dagar");
  });

  it("kastar för okänd mall", () => {
    expect(() => renderEmail("nope", {})).toThrow(/Okänd email-mall/);
  });
});
