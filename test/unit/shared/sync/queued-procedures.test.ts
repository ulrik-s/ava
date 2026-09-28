/**
 * Köbara procedurer (#1265, ADR 0037) — vilka tRPC-anrop som köas som ANROP
 * (och körs om auktoritativt på servern) i stället för som färdiga rader.
 *
 * Migreringen sker entitet för entitet; tidsposter först. Allt som inte står i
 * registret går som förut via radkön.
 */
import { describe, expect, it } from "vitest-compat";
import { isQueuedProcedure, prepareQueuedInput, QUEUED_PROCEDURES } from "@/lib/shared/sync/queued-procedures";
import { isUuid } from "@/lib/shared/uuid";

describe("isQueuedProcedure", () => {
  it("tidsposternas skapa/ändra/ta bort köas som anrop", () => {
    expect(isQueuedProcedure("timeEntry.create")).toBe(true);
    expect(isQueuedProcedure("timeEntry.update")).toBe(true);
    expect(isQueuedProcedure("timeEntry.delete")).toBe(true);
  });

  it("allt annat går via radkön (ännu inte flyttat)", () => {
    expect(isQueuedProcedure("timeEntry.markAsRadgivning")).toBe(false);
    expect(isQueuedProcedure("contacts.create")).toBe(false);
    expect(isQueuedProcedure("timeEntry.list")).toBe(false);
    expect(isQueuedProcedure("")).toBe(false);
    expect(isQueuedProcedure("constructor")).toBe(false);
    expect(isQueuedProcedure("__proto__")).toBe(false);
  });

  it("registret är fryst — kan inte utökas i körtid", () => {
    expect(Object.isFrozen(QUEUED_PROCEDURES)).toBe(true);
  });
});

describe("prepareQueuedInput — deterministisk omkörning", () => {
  it("create utan id får ett klient-genererat UUIDv7 (servern skapar SAMMA rad)", () => {
    const out = prepareQueuedInput("timeEntry.create", { matterId: "m", minutes: 30 }) as { id: string; minutes: number };
    expect(isUuid(out.id)).toBe(true);
    expect(out.minutes).toBe(30);
  });

  it("create med id behåller det", () => {
    expect(prepareQueuedInput("timeEntry.create", { id: "given" })).toEqual({ id: "given" });
  });

  it("update/delete lämnas orörda", () => {
    const input = { id: "x", minutes: 5 };
    expect(prepareQueuedInput("timeEntry.update", input)).toBe(input);
    expect(prepareQueuedInput("timeEntry.delete", { id: "x" })).toEqual({ id: "x" });
  });

  it("icke-objekt-input spelas inte in (null)", () => {
    expect(prepareQueuedInput("timeEntry.create", undefined)).toBeNull();
    expect(prepareQueuedInput("timeEntry.create", [1])).toBeNull();
    expect(prepareQueuedInput("timeEntry.update", "x")).toBeNull();
  });
});
