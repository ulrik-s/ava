/**
 * Synkläget per enhet (#1267) — det servern vet om varje webbläsare som synkar.
 *
 * Klienten rapporterar efter varje lyckad synk hur många ändringar som ligger
 * kvar i kön och när den äldsta gjordes. Servern sparar senaste rapporten. En
 * enhet som slutar rapportera har ändå kvar sitt senaste läge, och det åldras:
 * en ändring som var 20 timmar gammal vid rapporten är 30 timmar gammal tio
 * timmar senare, även om enheten är avstängd.
 *
 * Incidenten 2026-09-23 (data låg bara i en webbläsare) upptäcktes först när
 * användaren saknade sitt arbete. Med det här ser admin det innan.
 */

/** En enhets rapport vid en synk. */
export interface SyncDeviceReport {
  /** Webbläsarens eget id (beständigt per webbläsarprofil). */
  deviceId: string;
  /** Kort beskrivning av enheten, t.ex. "Chrome på macOS". */
  label: string | null;
  /** Ändringar som ligger kvar i kön efter synken. */
  pendingCount: number;
  /** När den äldsta av dem gjordes (epoch-ms), eller null. */
  oldestPendingAt: number | null;
}

/** En enhet som servern känner till. */
export interface SyncDevice extends SyncDeviceReport {
  userId: string;
  /** Senaste rapporten (epoch-ms, serverns klocka). */
  lastSeenAt: number;
}

/**
 * `ok`, `stuck` (en osynkad ändring är äldre än ett dygn) eller `silent`
 * (enheten har inte synkat på en vecka — arbete gjort offline sedan dess
 * syns inte för servern).
 */
export type DeviceHealth = "ok" | "stuck" | "silent";

/** En osynkad ändring äldre än så här larmar. */
export const STUCK_AFTER_MS = 24 * 60 * 60 * 1000;
/** En enhet som inte synkat på så här länge larmar. */
export const SILENT_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** Enhetens läge nu. En fastnad ändring väger tyngre än en tyst enhet. */
export function deviceHealth(d: Pick<SyncDevice, "pendingCount" | "oldestPendingAt" | "lastSeenAt">, now: number): DeviceHealth {
  if (d.pendingCount > 0 && d.oldestPendingAt !== null && now - d.oldestPendingAt >= STUCK_AFTER_MS) return "stuck";
  return now - d.lastSeenAt >= SILENT_AFTER_MS ? "silent" : "ok";
}

/** Enheterna som behöver admins uppmärksamhet just nu. */
export function devicesNeedingAttention<T extends Pick<SyncDevice, "pendingCount" | "oldestPendingAt" | "lastSeenAt">>(devices: readonly T[], now: number): T[] {
  return devices.filter((d) => deviceHealth(d, now) !== "ok");
}
