/**
 * E-post-avstängningen (AVA_EMAIL_DISABLED): ingenting får köas eller skickas,
 * inte ens om SMTP är fullt konfigurerat.
 */
import { describe, expect, it } from "bun:test";
import {
  DisabledEmailSender,
  EMAIL_DISABLED_MESSAGE,
  emailStatusLine,
  isEmailDisabled,
} from "@/lib/server/integrations/email/disabled-email-sender";
import { QueueBackedEmailSender, makeEmailPort } from "@/lib/server/jobs/queue-backed-email-sender";
import { loadActiveSmtpConfig } from "@/lib/server/jobs/server-first-handlers";

const FULL_SMTP = {
  AVA_SMTP_HOST: "smtp.byra.se", AVA_SMTP_PORT: "587", AVA_SMTP_USER: "u",
  AVA_SMTP_PASS: "p", AVA_SMTP_FROM: "ava@byra.se",
};

describe("DisabledEmailSender", () => {
  it("vägrar med tydligt fel i st.f. att tyst låtsas skicka", async () => {
    await expect(new DisabledEmailSender().send({ to: "klient@x.se", subject: "Faktura", text: "…" }))
      .rejects.toThrow(EMAIL_DISABLED_MESSAGE);
  });
});

describe("isEmailDisabled", () => {
  it("1 och true stänger av", () => {
    expect(isEmailDisabled({ AVA_EMAIL_DISABLED: "1" })).toBe(true);
    expect(isEmailDisabled({ AVA_EMAIL_DISABLED: "true" })).toBe(true);
  });

  it("saknad eller annat värde = utskick på (dagens beteende)", () => {
    expect(isEmailDisabled({})).toBe(false);
    expect(isEmailDisabled({ AVA_EMAIL_DISABLED: "0" })).toBe(false);
  });
});

describe("loadActiveSmtpConfig", () => {
  it("avstängt vinner över fullt konfigurerat SMTP → ingen utskicks-handler", () => {
    expect(loadActiveSmtpConfig({ ...FULL_SMTP, AVA_EMAIL_DISABLED: "1" })).toBeUndefined();
  });

  it("utan avstängning läses SMTP som förut", () => {
    expect(loadActiveSmtpConfig(FULL_SMTP)?.host).toBe("smtp.byra.se");
  });
});

describe("makeEmailPort", () => {
  it("avstängt → vägrande port; den KÖAR inget (boss:en rörs aldrig)", async () => {
    let bossTouched = false;
    const port = makeEmailPort(() => { bossTouched = true; return null; }, { AVA_EMAIL_DISABLED: "1" });
    expect(port).toBeInstanceOf(DisabledEmailSender);
    await expect(port.send({ to: "k@x.se", subject: "s", text: "t" })).rejects.toThrow(EMAIL_DISABLED_MESSAGE);
    expect(bossTouched).toBe(false);
  });

  it("på → den köande porten som förut", () => {
    expect(makeEmailPort(() => null, {})).toBeInstanceOf(QueueBackedEmailSender);
  });
});

describe("emailStatusLine", () => {
  it("säger tydligt i startloggen när utskick är avstängt", () => {
    expect(emailStatusLine({ AVA_EMAIL_DISABLED: "1" })).toContain("AVSTÄNGT");
    expect(emailStatusLine({})).toContain("på");
  });
});
