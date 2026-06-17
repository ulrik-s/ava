/**
 * Tester för `createSmtpSender` (#180, #27 coverage) — det tunna nodemailer-
 * skalet. `nodemailer.createTransport` spioneras (ingen riktig SMTP-anslutning);
 * vi verifierar transport-konfigen (host/port/auth/secure-default) samt att
 * `sendMail` vidarebefordrar from/to/subject/text och returnerar messageId.
 */

import nodemailer from "nodemailer";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest-compat";
import { createSmtpSender, type SmtpConfig } from "@/lib/server/integrations/email/smtp-sender";

const baseCfg: SmtpConfig = {
  host: "smtp.example.com",
  port: 587,
  user: "byra@example.com",
  pass: "hemlig",
  from: "noreply@example.com",
};

let sendMailMock: ReturnType<typeof vi.fn>;
let createTransportSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  sendMailMock = vi.fn(async () => ({ messageId: "<msg-123@example.com>" }));
  createTransportSpy = vi
    .spyOn(nodemailer, "createTransport")
    .mockReturnValue({ sendMail: sendMailMock } as never);
});

afterEach(() => {
  createTransportSpy.mockRestore();
});

describe("createSmtpSender — transport-konfig", () => {
  it("skickar host/port/auth vidare till createTransport", () => {
    createSmtpSender(baseCfg);
    expect(createTransportSpy).toHaveBeenCalledTimes(1);
    expect(createTransportSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.example.com",
        port: 587,
        auth: { user: "byra@example.com", pass: "hemlig" },
      }),
    );
  });

  it("secure defaultar till false för icke-465-port (STARTTLS)", () => {
    createSmtpSender(baseCfg);
    expect(createTransportSpy.mock.calls[0]![0]).toMatchObject({ secure: false });
  });

  it("secure defaultar till true för port 465 (implicit TLS)", () => {
    createSmtpSender({ ...baseCfg, port: 465 });
    expect(createTransportSpy.mock.calls[0]![0]).toMatchObject({ secure: true });
  });

  it("explicit secure-flagga vinner över port-defaulten", () => {
    createSmtpSender({ ...baseCfg, port: 465, secure: false });
    expect(createTransportSpy.mock.calls[0]![0]).toMatchObject({ secure: false });
    createTransportSpy.mockClear();
    createSmtpSender({ ...baseCfg, port: 587, secure: true });
    expect(createTransportSpy.mock.calls[0]![0]).toMatchObject({ secure: true });
  });
});

describe("createSmtpSender — sendMail", () => {
  it("vidarebefordrar from (ur konfig) + to/subject/text (ur meddelandet)", async () => {
    const sender = createSmtpSender(baseCfg);
    const res = await sender.sendMail({
      to: "domstol@example.se",
      subject: "Kostnadsräkning mål T 123-26",
      text: "Bifogat: kostnadsräkning.",
    });
    expect(sendMailMock).toHaveBeenCalledWith({
      from: "noreply@example.com",
      to: "domstol@example.se",
      subject: "Kostnadsräkning mål T 123-26",
      text: "Bifogat: kostnadsräkning.",
    });
    expect(res).toEqual({ messageId: "<msg-123@example.com>" });
  });

  it("propagerar fel från transporten (kastar vidare)", async () => {
    sendMailMock.mockRejectedValueOnce(new Error("550 relay denied"));
    const sender = createSmtpSender(baseCfg);
    await expect(
      sender.sendMail({ to: "x@y.se", subject: "s", text: "t" }),
    ).rejects.toThrow(/relay denied/);
  });
});
