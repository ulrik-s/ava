/**
 * E-postutskicks-handler + handler-registret (#504 Fas 3). Rena enhetstester
 * (ingen Postgres): handlern validerar payloaden, skickar via injicerad sender,
 * och propagerar fel (→ pg-boss retry). Registret kopplar in email-handlern bara
 * när SMTP är konfigurerat; SMTP-env-läsaren kräver alla nycklar.
 */

import type { Job } from "pg-boss";
import { describe, it, expect, vi } from "vitest-compat";
import type { EmailSender } from "@/lib/server/integrations/email/email-sender";
import { createEmailDispatchHandler } from "@/lib/server/jobs/handlers/email-dispatch-handler";
import { JOB_QUEUES } from "@/lib/server/jobs/job-queue";
import { buildServerFirstJobHandlers, loadSmtpConfigFromEnv } from "@/lib/server/jobs/server-first-handlers";

const job = (data: unknown): Job => ({ id: "j1", name: "email-dispatch", data } as unknown as Job);

describe("createEmailDispatchHandler", () => {
  it("validerar payloaden och skickar mejlet", async () => {
    const sendMail = vi.fn(async () => ({ messageId: "<m1>" }));
    const sender: EmailSender = { sendMail };
    await createEmailDispatchHandler(sender)(job({ to: "domstol@ex.se", subject: "Faktura F-1", text: "Bifogat." }));
    expect(sendMail).toHaveBeenCalledWith({ to: "domstol@ex.se", subject: "Faktura F-1", text: "Bifogat." });
  });

  it("ogiltig payload → kastar (zod) utan att skicka", async () => {
    const sendMail = vi.fn(async () => ({ messageId: "x" }));
    await expect(createEmailDispatchHandler({ sendMail })(job({ subject: "x" }))).rejects.toThrow();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("propagerar sänd-fel (→ pg-boss retry/dead-letter)", async () => {
    const sender: EmailSender = { sendMail: vi.fn(async () => { throw new Error("550 relay denied"); }) };
    await expect(
      createEmailDispatchHandler(sender)(job({ to: "x@y.se", subject: "s", text: "t" })),
    ).rejects.toThrow(/relay denied/);
  });
});

describe("buildServerFirstJobHandlers", () => {
  const smtp = { host: "smtp.ex.se", port: 587, user: "u", pass: "p", from: "noreply@ex.se" };

  it("registrerar email-handlern när SMTP finns", () => {
    const handlers = buildServerFirstJobHandlers({ smtp });
    expect(typeof handlers[JOB_QUEUES.emailDispatch]).toBe("function");
  });

  it("ingen email-handler utan SMTP", () => {
    expect(buildServerFirstJobHandlers({})).toEqual({});
  });
});

describe("loadSmtpConfigFromEnv", () => {
  const full = {
    AVA_SMTP_HOST: "smtp.ex.se", AVA_SMTP_PORT: "465", AVA_SMTP_USER: "u",
    AVA_SMTP_PASS: "p", AVA_SMTP_FROM: "noreply@ex.se",
  };

  it("läser alla nycklar → SmtpConfig (port som number)", () => {
    expect(loadSmtpConfigFromEnv(full)).toEqual({ host: "smtp.ex.se", port: 465, user: "u", pass: "p", from: "noreply@ex.se" });
  });

  it("AVA_SMTP_SECURE styr secure-flaggan", () => {
    expect(loadSmtpConfigFromEnv({ ...full, AVA_SMTP_SECURE: "true" })).toMatchObject({ secure: true });
    expect(loadSmtpConfigFromEnv({ ...full, AVA_SMTP_SECURE: "false" })).toMatchObject({ secure: false });
  });

  it("saknad nyckel → undefined (avregistrerar tyst)", () => {
    const { AVA_SMTP_PASS: _omit, ...partial } = full;
    expect(loadSmtpConfigFromEnv(partial)).toBeUndefined();
  });
});
