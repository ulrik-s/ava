/**
 * Tester för SMTP-utskick. Mockar nodemailer.createTransport och verifierar
 * att rätt sendMail-anrop görs för respektive mall + att lazy-cachning av
 * transporten fungerar.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { sendMailMock, createTransportMock } = vi.hoisted(() => {
  const sendMailMock = vi.fn().mockResolvedValue({ messageId: "x" });
  const createTransportMock = vi.fn(
    (_cfg: Record<string, unknown>) => ({ sendMail: sendMailMock }),
  );
  return { sendMailMock, createTransportMock };
});

vi.mock("nodemailer", () => ({
  default: { createTransport: createTransportMock },
  createTransport: createTransportMock,
}));

import {
  sendEmail,
  sendPaymentDue,
  sendPaymentOverdue,
  __resetEmailTransportForTests,
  type PaymentReminderContext,
} from "@/server/services/email";

const baseCtx: PaymentReminderContext = {
  recipientEmail: "klient@example.com",
  recipientName: "Anna Klient",
  matterNumber: "2026-0001",
  matterTitle: "Vårdnadstvist",
  invoiceAmount: 5000000,
  monthlyAmount: 500000,
  dayOfMonth: 25,
  remainingAmount: 4500000,
  organizationName: "Advokat AB",
  organizationContact: "Erik Advokat",
  bankgiro: "123-4567",
};

beforeEach(() => {
  vi.clearAllMocks();
  __resetEmailTransportForTests();
  process.env.SMTP_USER = "user@example.com";
  process.env.SMTP_PASS = "secret";
  process.env.SMTP_FROM = "Advokat AB <faktura@example.com>";
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
});

afterEach(() => {
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.SMTP_FROM;
});

describe("sendEmail", () => {
  it("skickar text-mail med default-from och defaults för host/port", async () => {
    await sendEmail({ to: "to@example.com", subject: "Hej", text: "Body" });
    expect(createTransportMock).toHaveBeenCalledTimes(1);
    const cfg = createTransportMock.mock.calls[0][0] as Record<string, unknown>;
    expect(cfg.host).toBe("smtp.office365.com");
    expect(cfg.port).toBe(587);
    expect(cfg.secure).toBe(false);
    expect(cfg.requireTLS).toBe(true);
    expect(cfg.auth).toEqual({ user: "user@example.com", pass: "secret" });

    expect(sendMailMock).toHaveBeenCalledWith({
      from: "Advokat AB <faktura@example.com>",
      to: "to@example.com",
      subject: "Hej",
      text: "Body",
    });
  });

  it("inkluderar html när det skickas med", async () => {
    await sendEmail({ to: "x@y", subject: "S", text: "T", html: "<p>T</p>" });
    expect(sendMailMock.mock.calls[0][0].html).toBe("<p>T</p>");
  });

  it("kastar om SMTP_USER saknas", async () => {
    delete process.env.SMTP_USER;
    await expect(
      sendEmail({ to: "a@b", subject: "x", text: "y" }),
    ).rejects.toThrow(/SMTP_USER/);
  });

  it("kastar om SMTP_FROM och SMTP_USER saknas helt", async () => {
    delete process.env.SMTP_FROM;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    // Ingen user → from-check kastar först
    await expect(
      sendEmail({ to: "a@b", subject: "x", text: "y" }),
    ).rejects.toThrow(/SMTP_FROM/);
  });

  it("använder secure=true för port 465", async () => {
    process.env.SMTP_PORT = "465";
    await sendEmail({ to: "a@b", subject: "s", text: "t" });
    const cfg = createTransportMock.mock.calls[0][0] as Record<string, unknown>;
    expect(cfg.port).toBe(465);
    expect(cfg.secure).toBe(true);
    expect(cfg.requireTLS).toBe(false);
  });

  it("cachar transporten mellan anrop", async () => {
    await sendEmail({ to: "a@b", subject: "s", text: "t" });
    await sendEmail({ to: "a@b", subject: "s", text: "t" });
    expect(createTransportMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).toHaveBeenCalledTimes(2);
  });

  it("__resetEmailTransportForTests tvingar fram ny createTransport", async () => {
    await sendEmail({ to: "a@b", subject: "s", text: "t" });
    __resetEmailTransportForTests();
    await sendEmail({ to: "a@b", subject: "s", text: "t" });
    expect(createTransportMock).toHaveBeenCalledTimes(2);
  });
});

describe("sendPaymentDue", () => {
  it("har rätt ämnesrad med matterNumber + title", async () => {
    await sendPaymentDue(baseCtx);
    const args = sendMailMock.mock.calls[0][0];
    expect(args.to).toBe("klient@example.com");
    expect(args.subject).toContain("Månadens betalning");
    expect(args.subject).toContain("2026-0001");
    expect(args.subject).toContain("Vårdnadstvist");
  });

  it("inkluderar belopp och bankgiro i textkroppen", async () => {
    await sendPaymentDue(baseCtx);
    const text: string = sendMailMock.mock.calls[0][0].text;
    expect(text).toContain("Anna Klient");
    expect(text).toMatch(/5\s000,00 kr/); // monthlyAmount 500000 öre (sv-SE NBSP)
    expect(text).toMatch(/45\s000,00 kr/); // remaining 4500000 öre
    expect(text).toContain("123-4567");
    expect(text).toContain("Advokat AB");
    expect(text).toContain("Erik Advokat");
  });

  it("hoppar över bankgiro-rad om bankgiro saknas", async () => {
    await sendPaymentDue({ ...baseCtx, bankgiro: undefined });
    const text: string = sendMailMock.mock.calls[0][0].text;
    expect(text).not.toContain("Bankgiro:");
  });
});

describe("sendPaymentOverdue", () => {
  it("har PÅMINNELSE-prefix i subject", async () => {
    await sendPaymentOverdue(baseCtx);
    const args = sendMailMock.mock.calls[0][0];
    expect(args.subject).toContain("PÅMINNELSE");
    expect(args.subject).toContain("2026-0001");
  });

  it("nämner förfallodag och 10-dagar i texten", async () => {
    await sendPaymentOverdue(baseCtx);
    const text: string = sendMailMock.mock.calls[0][0].text;
    expect(text).toContain("25");
    expect(text).toContain("10 dagar");
    expect(text).toMatch(/5\s000,00 kr/);
  });

  it("hoppar över organizationContact om saknas", async () => {
    await sendPaymentOverdue({ ...baseCtx, organizationContact: undefined });
    const text: string = sendMailMock.mock.calls[0][0].text;
    expect(text).toContain("Advokat AB");
  });
});
