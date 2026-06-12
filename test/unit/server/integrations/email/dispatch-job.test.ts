import { describe, it, expect } from "vitest-compat";
import {
  dispatchQueuedEmails,
  buildInvoiceEmail,
  makeDispatchJob,
  type DispatchJobCaller,
  type QueuedDispatch,
} from "@/lib/server/integrations/email/dispatch-job";
import type { EmailSender } from "@/lib/server/integrations/email/email-sender";

function makeCaller(queued: QueuedDispatch[]) {
  const updates: Array<{ dispatchId: string; status: string; messageId?: string; error?: string }> = [];
  const caller: DispatchJobCaller = {
    invoiceDispatch: {
      listQueued: async () => queued,
      updateStatus: async (input) => { updates.push(input); return {}; },
    },
  };
  return { caller, updates };
}

const okSender: EmailSender = { sendMail: async () => ({ messageId: "<msg-1>" }) };
const failSender: EmailSender = { sendMail: async () => { throw new Error("SMTP 550"); } };

const emailDispatch: QueuedDispatch = {
  id: "d-1", channel: "email", recipient: "klient@x.se",
  invoice: { invoiceNumber: "F-2026-0042", amount: 12_500, ocrReference: "2026004206", dueDate: "2026-06-30" },
};

describe("buildInvoiceEmail", () => {
  it("bygger ämne + text med fakturanr, belopp, OCR och förfallodatum", () => {
    const msg = buildInvoiceEmail(emailDispatch, "Byrå AB");
    expect(msg.to).toBe("klient@x.se");
    expect(msg.subject).toBe("Faktura F-2026-0042 från Byrå AB");
    expect(msg.text).toContain("125 kr");
    expect(msg.text).toContain("OCR: 2026004206");
    expect(msg.text).toContain("Förfallodatum");
  });
});

describe("dispatchQueuedEmails", () => {
  it("skickar köade e-postutskick → markerar sent med messageId", async () => {
    const { caller, updates } = makeCaller([emailDispatch]);
    const res = await dispatchQueuedEmails(caller, { loadSender: () => okSender });
    expect(res).toEqual({ sent: 1, failed: 0 });
    expect(updates).toEqual([{ dispatchId: "d-1", status: "sent", messageId: "<msg-1>" }]);
  });

  it("sändningsfel → markerar failed med error", async () => {
    const { caller, updates } = makeCaller([emailDispatch]);
    const res = await dispatchQueuedEmails(caller, { loadSender: () => failSender });
    expect(res).toEqual({ sent: 0, failed: 1 });
    expect(updates[0]).toMatchObject({ dispatchId: "d-1", status: "failed" });
    expect(updates[0]!.error).toContain("SMTP 550");
  });

  it("hoppar över icke-email-kanaler (bara SMTP-connectorn här)", async () => {
    const { caller, updates } = makeCaller([{ id: "d-2", channel: "kivra", recipient: "199001011234" }]);
    const res = await dispatchQueuedEmails(caller, { loadSender: () => okSender });
    expect(res).toEqual({ sent: 0, failed: 0 });
    expect(updates).toHaveLength(0);
  });

  it("ingen sändare konfigurerad → hoppar över", async () => {
    const { caller, updates } = makeCaller([emailDispatch]);
    const res = await dispatchQueuedEmails(caller, { loadSender: () => null });
    expect(res).toEqual({ sent: 0, failed: 0 });
    expect(updates).toHaveLength(0);
  });
});

describe("makeDispatchJob", () => {
  it("PeerJob:s act skickar via callern", async () => {
    const { caller, updates } = makeCaller([emailDispatch]);
    const job = makeDispatchJob({ loadSender: () => okSender });
    expect(job.message).toMatch(/dispatch/i);
    await job.act(caller as unknown as Parameters<typeof job.act>[0]);
    expect(updates[0]?.status).toBe("sent");
  });
});
