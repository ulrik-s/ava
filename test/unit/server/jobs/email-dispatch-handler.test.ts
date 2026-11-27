/**
 * E-postutskicks-handler + handler-registret (#504 Fas 3). Rena enhetstester
 * (ingen Postgres): handlern validerar payloaden, skickar via injicerad sender,
 * och propagerar fel (→ pg-boss retry). Registret kopplar in email-handlern bara
 * när SMTP är konfigurerat; SMTP-env-läsaren kräver alla nycklar.
 */

import type { Job } from "pg-boss";
import { describe, it, expect, vi } from "vitest-compat";
import type { EmailSender } from "@/lib/server/integrations/email/email-sender";
import type { EmailDispatchLog } from "@/lib/server/jobs/email-dispatch-log";
import { createEmailDispatchHandler } from "@/lib/server/jobs/handlers/email-dispatch-handler";
import { JOB_QUEUES } from "@/lib/server/jobs/job-queue";
import { buildServerFirstJobHandlers, loadSmtpConfigFromEnv } from "@/lib/server/jobs/server-first-handlers";
import type { LedgerKeepAliveOutcome } from "@/lib/server/ports";

const job = (data: unknown): Job => ({ id: "j1", name: "email-dispatch", data } as unknown as Job);

/** En logg i minnet: `sent` är de redan skickade nycklarna (`<byrå>|<nyckel>`). */
function memoryLog(sent: string[] = []) {
  const keys = new Set(sent);
  const has = vi.fn((org: string, key: string) => Promise.resolve(keys.has(`${org}|${key}`)));
  const record = vi.fn((org: string, key: string) => { keys.add(`${org}|${key}`); return Promise.resolve(); });
  const log: EmailDispatchLog = { has, record };
  return { log, has, record };
}

const keyed = { to: "x@y.se", subject: "s", text: "t", organizationId: "org-1", idempotencyKey: "payment.due:p1:2026-11" };

describe("createEmailDispatchHandler", () => {
  it("validerar payloaden och skickar mejlet", async () => {
    const sendMail = vi.fn(() => Promise.resolve({ messageId: "<m1>" }));
    const sender: EmailSender = { sendMail };
    await createEmailDispatchHandler(sender)(job({ to: "domstol@ex.se", subject: "Faktura F-1", text: "Bifogat." }));
    expect(sendMail).toHaveBeenCalledWith({ to: "domstol@ex.se", subject: "Faktura F-1", text: "Bifogat." });
  });

  it("ogiltig payload → kastar (zod) utan att skicka", async () => {
    const sendMail = vi.fn(() => Promise.resolve({ messageId: "x" }));
    await expect(createEmailDispatchHandler({ sendMail })(job({ subject: "x" }))).rejects.toThrow();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("propagerar sänd-fel (→ pg-boss retry/dead-letter)", async () => {
    const sender: EmailSender = { sendMail: vi.fn(() => Promise.reject(new Error("550 relay denied"))) };
    await expect(
      createEmailDispatchHandler(sender)(job({ to: "x@y.se", subject: "s", text: "t" })),
    ).rejects.toThrow(/relay denied/);
  });
});

describe("createEmailDispatchHandler med loggen (#1901)", () => {
  it("en redan loggad nyckel ger inget utskick, och jobbet blir klart", async () => {
    const sendMail = vi.fn(() => Promise.resolve({ messageId: "x" }));
    const { log, record } = memoryLog(["org-1|payment.due:p1:2026-11"]);
    await createEmailDispatchHandler({ sendMail }, log)(job(keyed));
    expect(sendMail).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it("en ny nyckel skickas med bara {to,subject,text} och loggas som (byrå, nyckel)", async () => {
    const sendMail = vi.fn(() => Promise.resolve({ messageId: "x" }));
    const { log, record } = memoryLog();
    await createEmailDispatchHandler({ sendMail }, log)(job(keyed));
    expect(sendMail).toHaveBeenCalledWith({ to: "x@y.se", subject: "s", text: "t" });
    expect(record).toHaveBeenCalledWith("org-1", "payment.due:p1:2026-11");
  });

  it("samma nyckel två gånger skickas en gång", async () => {
    const sendMail = vi.fn(() => Promise.resolve({ messageId: "x" }));
    const { log } = memoryLog();
    const handler = createEmailDispatchHandler({ sendMail }, log);
    await handler(job(keyed));
    await handler(job(keyed));
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it("vid SMTP-fel loggas inget, och felet kastas", async () => {
    const sendMail = vi.fn(() => Promise.reject(new Error("550 relay denied")));
    const { log, record } = memoryLog();
    await expect(createEmailDispatchHandler({ sendMail }, log)(job(keyed))).rejects.toThrow(/relay denied/);
    expect(record).not.toHaveBeenCalled();
  });

  it("utan nyckel skickas mejlet utan att loggen tillfrågas", async () => {
    const sendMail = vi.fn(() => Promise.resolve({ messageId: "x" }));
    const { log, has, record } = memoryLog();
    await createEmailDispatchHandler({ sendMail }, log)(job({ to: "x@y.se", subject: "s", text: "t", organizationId: "org-1" }));
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(has).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it("utan byrå skickas mejlet utan att loggen tillfrågas", async () => {
    const sendMail = vi.fn(() => Promise.resolve({ messageId: "x" }));
    const { log, has } = memoryLog();
    await createEmailDispatchHandler({ sendMail }, log)(job({ to: "x@y.se", subject: "s", text: "t", idempotencyKey: "k" }));
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(has).not.toHaveBeenCalled();
  });

  it("ett gammalt jobb {to,subject,text} parsas och skickas", async () => {
    const sendMail = vi.fn(() => Promise.resolve({ messageId: "x" }));
    const { log, has } = memoryLog();
    await createEmailDispatchHandler({ sendMail }, log)(job({ to: "x@y.se", subject: "s", text: "t" }));
    expect(sendMail).toHaveBeenCalledWith({ to: "x@y.se", subject: "s", text: "t" });
    expect(has).not.toHaveBeenCalled();
  });

  it("utan logg skickas ett jobb med nyckel varje gång", async () => {
    const sendMail = vi.fn(() => Promise.resolve({ messageId: "x" }));
    const handler = createEmailDispatchHandler({ sendMail });
    await handler(job(keyed));
    await handler(job(keyed));
    expect(sendMail).toHaveBeenCalledTimes(2);
  });
});

describe("buildServerFirstJobHandlers", () => {
  const smtp = { host: "smtp.ex.se", port: 587, user: "u", pass: "p", from: "noreply@ex.se" };

  it("registrerar email-handlern när SMTP finns", () => {
    const handlers = buildServerFirstJobHandlers({ smtp });
    expect(typeof handlers[JOB_QUEUES.emailDispatch]).toBe("function");
  });

  it("med emailLog hoppar email-handlern över en loggad nyckel (#1901)", async () => {
    const { log, has } = memoryLog(["org-1|payment.due:p1:2026-11"]);
    const handler = buildServerFirstJobHandlers({ smtp, emailLog: log })[JOB_QUEUES.emailDispatch];
    await handler?.(job(keyed));
    expect(has).toHaveBeenCalledWith("org-1", "payment.due:p1:2026-11");
  });

  it("ingen email-handler utan SMTP", () => {
    expect(buildServerFirstJobHandlers({})).toEqual({});
  });

  it("registrerar keepalive-handlern för bokföringen när den är konfigurerad (#1815)", () => {
    const ledger = { service: { keepAlive: vi.fn(() => Promise.resolve<LedgerKeepAliveOutcome>("alive")) }, orgId: "org-1" };
    expect(typeof buildServerFirstJobHandlers({ ledger })[JOB_QUEUES.ledgerKeepAlive]).toBe("function");
  });

  it("ingen keepalive-handler utan bokföring (#1815)", () => {
    expect(buildServerFirstJobHandlers({})[JOB_QUEUES.ledgerKeepAlive]).toBeUndefined();
  });

  it("registrerar integritetskontrollen när innehållslagret finns (#1993)", () => {
    const integrity = { deps: { listStoredContent: () => Promise.resolve([]), exists: () => Promise.resolve(true) }, orgId: "org-1" };
    expect(typeof buildServerFirstJobHandlers({ integrity })[JOB_QUEUES.contentIntegrity]).toBe("function");
  });

  it("ingen integritetskontroll utan innehållslager (#1993)", () => {
    expect(buildServerFirstJobHandlers({})[JOB_QUEUES.contentIntegrity]).toBeUndefined();
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
