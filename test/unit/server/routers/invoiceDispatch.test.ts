import { describe, it, expect } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";
import { asId } from "@/lib/shared/schemas/ids";

const PRINCIPAL: Principal = { id: asId<"UserId">("u-1"), email: "a@x", name: "Anna", role: "ADMIN", organizationId: asId<"OrganizationId">("org-1") };

function makeCaller() {
  const ds = new DemoDataStore({
    organizations: [{ id: "org-1", name: "Byrå" }, { id: "org-2", name: "Annan" }],
    matters: [
      { id: "m-1", organizationId: "org-1", matterNumber: "2026-0001", title: "T", status: "ACTIVE", createdAt: new Date() },
      { id: "m-2", organizationId: "org-2", matterNumber: "2026-0002", title: "U", status: "ACTIVE", createdAt: new Date() },
    ],
    users: [{ id: "u-1", organizationId: "org-1", email: "a@x", name: "Anna", role: "ADMIN" }],
    invoices: [
      { id: "inv-1", matterId: "m-1", amount: 12_500, status: "SENT", invoiceType: "STANDARD", invoiceDate: new Date(), createdAt: new Date() },
      { id: "inv-draft", matterId: "m-1", amount: 9_000, status: "DRAFT", invoiceType: "STANDARD", invoiceDate: new Date(), createdAt: new Date() },
      { id: "inv-foreign", matterId: "m-2", amount: 5_000, status: "SENT", invoiceType: "STANDARD", invoiceDate: new Date(), createdAt: new Date() },
    ],
  }, async () => {});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ds, caller: appRouter.createCaller(buildContext({ dataStore: ds, ports: noopPorts, principal: PRINCIPAL }) as any) };
}

describe("invoiceDispatch.queue + list", () => {
  it("köar ett utskick (status=queued) och listar det", async () => {
    const { caller } = makeCaller();
    const d = await caller.invoiceDispatch.queue({ invoiceId: "inv-1", channel: "email", recipient: "klient@x.se" });
    expect(d.status).toBe("queued");
    expect(d.channel).toBe("email");
    expect(d.queuedAt).toBeTruthy();

    const list = await caller.invoiceDispatch.list({ invoiceId: "inv-1" });
    expect(list).toHaveLength(1);
    expect(list[0]!.recipient).toBe("klient@x.se");
  });

  it("nekar utskick mot faktura i annan org (NOT_FOUND)", async () => {
    const { caller } = makeCaller();
    await expect(
      caller.invoiceDispatch.queue({ invoiceId: "inv-foreign", channel: "email", recipient: "x@y.se" }),
    ).rejects.toThrow();
  });
});

describe("invoiceDispatch.recordManual (#179)", () => {
  it("skapar ett utskick direkt som sent (med sentAt), aldrig queued", async () => {
    const { caller } = makeCaller();
    const d = await caller.invoiceDispatch.recordManual({ invoiceId: "inv-1", channel: "manual", recipient: "Manuellt utskick" });
    expect(d.status).toBe("sent");
    expect(d.sentAt).toBeTruthy();
    expect(d.channel).toBe("manual");

    // Får INTE dyka upp i listQueued (annars dubbel-skickar #180-workern).
    const queued = await caller.invoiceDispatch.listQueued();
    expect(queued.find((q) => q.id === d.id)).toBeUndefined();

    const list = await caller.invoiceDispatch.list({ invoiceId: "inv-1" });
    expect(list[0]!.status).toBe("sent");
  });

  it("e-postkanal med mottagaradress", async () => {
    const { caller } = makeCaller();
    const d = await caller.invoiceDispatch.recordManual({ invoiceId: "inv-1", channel: "email", recipient: "klient@x.se" });
    expect(d.channel).toBe("email");
    expect(d.recipient).toBe("klient@x.se");
  });

  it("nekar mot faktura i annan org (NOT_FOUND)", async () => {
    const { caller } = makeCaller();
    await expect(
      caller.invoiceDispatch.recordManual({ invoiceId: "inv-foreign", channel: "manual", recipient: "x" }),
    ).rejects.toThrow();
  });
});

describe("skickning flippar DRAFT → SENT (#392)", () => {
  it("queue på en DRAFT-faktura → fakturan blir SENT", async () => {
    const { caller } = makeCaller();
    await caller.invoiceDispatch.queue({ invoiceId: "inv-draft", channel: "email", recipient: "k@x.se" });
    const inv = await caller.invoice.getById({ id: "inv-draft" });
    expect(inv.status).toBe("SENT");
  });

  it("recordManual på en DRAFT-faktura → fakturan blir SENT", async () => {
    const { caller } = makeCaller();
    await caller.invoiceDispatch.recordManual({ invoiceId: "inv-draft", channel: "manual", recipient: "Manuellt" });
    const inv = await caller.invoice.getById({ id: "inv-draft" });
    expect(inv.status).toBe("SENT");
  });

  it("redan SENT lämnas oförändrad (ingen otillåten övergång)", async () => {
    const { caller } = makeCaller();
    await caller.invoiceDispatch.queue({ invoiceId: "inv-1", channel: "email", recipient: "k@x.se" });
    const inv = await caller.invoice.getById({ id: "inv-1" });
    expect(inv.status).toBe("SENT");
  });
});

describe("invoiceDispatch.updateStatus", () => {
  it("queued → sent sätter sentAt + messageId (idempotent)", async () => {
    const { caller } = makeCaller();
    const d = await caller.invoiceDispatch.queue({ invoiceId: "inv-1", channel: "email", recipient: "k@x.se" });

    const sent = await caller.invoiceDispatch.updateStatus({ dispatchId: d.id, status: "sent", messageId: "<msg-1>" });
    expect(sent.status).toBe("sent");
    expect(sent.sentAt).toBeTruthy();
    expect(sent.messageId).toBe("<msg-1>");

    // Idempotent: markera sent igen → fortf. sent
    const again = await caller.invoiceDispatch.updateStatus({ dispatchId: d.id, status: "sent" });
    expect(again.status).toBe("sent");
  });

  it("failed sätter failedAt + error", async () => {
    const { caller } = makeCaller();
    const d = await caller.invoiceDispatch.queue({ invoiceId: "inv-1", channel: "email", recipient: "k@x.se" });
    const failed = await caller.invoiceDispatch.updateStatus({ dispatchId: d.id, status: "failed", error: "SMTP 550" });
    expect(failed.status).toBe("failed");
    expect(failed.failedAt).toBeTruthy();
    expect(failed.error).toBe("SMTP 550");
  });
});
