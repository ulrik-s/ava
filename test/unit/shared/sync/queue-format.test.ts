/**
 * Köns formatversion (#1247) — ändringar från äldre klientkod.
 */
import { describe, expect, it } from "vitest-compat";
import {
  classifyQueueFormat,
  formatOf,
  migrateQueuePayload,
  QUEUE_FORMAT_VERSION,
  QUEUE_POLICY,
  tooNewMessage,
  tooOldMessage,
} from "@/lib/shared/sync/queue-format";

describe("köformatet", () => {
  it("poster utan stämpel skrevs i format 1", () => {
    expect(formatOf({})).toBe(1);
    expect(formatOf({ format: 3 })).toBe(3);
  });

  it("dagens policy: format 1 är aktuellt", () => {
    expect(QUEUE_POLICY).toMatchObject({ current: QUEUE_FORMAT_VERSION, min: 1 });
    expect(classifyQueueFormat(QUEUE_FORMAT_VERSION)).toBe("current");
  });

  it("utslaget per format mot gränserna", () => {
    const bounds = { current: 3, min: 2 };
    expect(classifyQueueFormat(1, bounds)).toBe("too-old");
    expect(classifyQueueFormat(2, bounds)).toBe("migrate");
    expect(classifyQueueFormat(3, bounds)).toBe("current");
    expect(classifyQueueFormat(4, bounds)).toBe("too-new");
  });

  it("migreringen lyfter steg för steg till dagens format", () => {
    const migrations = {
      1: (p: { input?: Record<string, unknown> }) => ({ ...p, input: { ...p.input, minutes: Number(p.input?.hours) * 60 } }),
      2: (p: { path?: string }) => ({ ...p, path: `${p.path}V3` }),
    };
    expect(migrateQueuePayload({ path: "timeEntry.create", input: { hours: 2 } }, 1, migrations, 3))
      .toEqual({ path: "timeEntry.createV3", input: { hours: 2, minutes: 120 } });
  });

  it("aktuellt format → oförändrad", () => {
    const payload = { entity: "timeEntry", row: { id: "t" } };
    expect(migrateQueuePayload(payload, QUEUE_FORMAT_VERSION)).toBe(payload);
  });

  it("ett saknat migreringssteg kastar (hellre tekniskt fel än fel format)", () => {
    expect(() => migrateQueuePayload({}, 1, {}, 2)).toThrow(/Ingen migrering av köposten från format 1 till 2/);
  });

  it("beskeden säger vad användaren ska göra", () => {
    expect(tooOldMessage(1)).toMatch(/för gammal version av AVA.*Gör om den/);
    expect(tooNewMessage(2)).toMatch(/sparas när servern har uppgraderats/);
  });
});
