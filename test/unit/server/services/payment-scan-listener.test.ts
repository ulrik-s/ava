/**
 * Tester för `attachPaymentScanListener`.
 *
 * Den här listenern är limmet som binder en regel-emittad
 * `system.payment_scan_requested` till `runPaymentScan`-service:n.
 * Mockar payment-scan så vi testar bara orkestreringen, inte SQL:en.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { attachPaymentScanListener } from "@/server/services/payment-scan-listener";
import * as scanModule from "@/server/services/payment-scan";
import type { IDataStore } from "@/server/data-store/IDataStore";
import type { AvaEvent } from "@/server/events/schema";

function makeEventLog(): {
  events: IDataStore["events"];
  fire: (e: AvaEvent) => Promise<void>;
  emit: ReturnType<typeof vi.fn>;
} {
  let listener: ((e: AvaEvent) => void | Promise<void>) | null = null;
  const emit = vi.fn(async () => ({}));
  const events = {
    emit,
    query: vi.fn(),
    iterate: vi.fn(),
    onNewEvent: vi.fn((handler: (e: AvaEvent) => void | Promise<void>) => {
      listener = handler;
      return () => { listener = null; };
    }),
  } as unknown as IDataStore["events"];
  return {
    events,
    fire: async (e) => { if (listener) await listener(e); },
    emit,
  };
}

const baseEvent: AvaEvent = {
  id: "evt-1",
  ts: "2026-05-18T09:00:00Z",
  type: "system.payment_scan_requested",
  source: "rule",
  actor: { kind: "rule", id: "_org/daily-payment-scan" },
  payload: {},
};

describe("attachPaymentScanListener", () => {
  let log: ReturnType<typeof makeEventLog>;
  let ds: IDataStore;
  let prisma: never;

  beforeEach(() => {
    vi.restoreAllMocks();
    log = makeEventLog();
    ds = { events: log.events } as unknown as IDataStore;
    prisma = {} as never;
    vi.spyOn(scanModule, "runPaymentScan").mockResolvedValue({
      organizationId: "org-1", plansChecked: 1, dueEmitted: 1, overdueEmitted: 0, skippedNoEmail: 0,
    });
  });

  it("kallar runPaymentScan när rätt event-typ kommer in", async () => {
    attachPaymentScanListener(prisma, ds, "org-1");
    await log.fire(baseEvent);
    expect(scanModule.runPaymentScan).toHaveBeenCalledTimes(1);
    expect(scanModule.runPaymentScan).toHaveBeenCalledWith(prisma, ds, "org-1");
  });

  it("ignorerar andra event-typer", async () => {
    attachPaymentScanListener(prisma, ds, "org-1");
    await log.fire({ ...baseEvent, type: "matter.created" });
    expect(scanModule.runPaymentScan).not.toHaveBeenCalled();
  });

  it("emittar rule.failed-event om payment-scan kastar", async () => {
    vi.spyOn(scanModule, "runPaymentScan").mockRejectedValue(new Error("DB-fel"));
    attachPaymentScanListener(prisma, ds, "org-1");
    await log.fire(baseEvent);

    const failEvent = log.emit.mock.calls.find(
      (c) => (c[0] as { type: string }).type === "rule.failed",
    );
    expect(failEvent).toBeTruthy();
    const args = failEvent![0] as { payload: { error: string }; causedBy: string };
    expect(args.payload.error).toBe("DB-fel");
    expect(args.causedBy).toBe(baseEvent.id);
  });

  it("emit av rule.failed sväljs om även den kraschar (loops förhindrade)", async () => {
    vi.spyOn(scanModule, "runPaymentScan").mockRejectedValue(new Error("DB-fel"));
    log.emit.mockRejectedValue(new Error("Event-log nere"));
    attachPaymentScanListener(prisma, ds, "org-1");
    // Får inte kasta — om både scan OCH emit fail:ar är vi i ett trasigt
    // tillstånd men ska INTE krascha listenern
    await expect(log.fire(baseEvent)).resolves.toBeUndefined();
  });

  it("returnerar disposer som avregistrerar listenern", async () => {
    const disposer = attachPaymentScanListener(prisma, ds, "org-1");
    disposer();
    await log.fire(baseEvent);
    expect(scanModule.runPaymentScan).not.toHaveBeenCalled();
  });
});
