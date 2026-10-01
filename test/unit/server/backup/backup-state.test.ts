/**
 * Backupläget (#1431): pågår / klar / misslyckad, och när en ny begäran tas emot.
 */
import { describe, expect, it } from "vitest-compat";
import { assertMayRequest, BACKUP_MIN_INTERVAL_MS, BACKUP_TIMEOUT_MS, backupStatus } from "@/lib/server/backup/backup-state";
import { backupFileNameSchema, sha256HexSchema, type BackupExport } from "@/lib/shared/backup";

const NOW = 1_800_000_000_000;
const MIN = 60_000;

function exportAt(createdAt: number): BackupExport {
  return { name: backupFileNameSchema.parse("ava-2026-10-01-0300.tar.age"), sizeBytes: 2048, createdAt, sha256: sha256HexSchema.parse("a".repeat(64)) };
}
const requestAt = (requestedAt: number) => ({ requestId: "0190a3f0-0000-7000-8000-000000000001", requestedAt });

describe("backupStatus", () => {
  it("ingen export och ingen begäran: idle, en begäran tas emot direkt", () => {
    expect(backupStatus(null, null, NOW)).toEqual({ state: "idle", latest: null, requestedAt: null, nextRequestAt: 0 });
  });

  it("begärd, ingen nyare export: pågår", () => {
    const s = backupStatus(exportAt(NOW - 60 * MIN), requestAt(NOW - 2 * MIN), NOW);
    expect(s.state).toBe("running");
    expect(s.requestedAt).toBe(NOW - 2 * MIN);
  });

  it("begärd utan någon export alls: pågår", () => {
    expect(backupStatus(null, requestAt(NOW - MIN), NOW).state).toBe("running");
  });

  it("en export som skrevs efter begäran är svaret: idle", () => {
    const latest = exportAt(NOW - MIN);
    const s = backupStatus(latest, requestAt(NOW - 3 * MIN), NOW);
    expect(s).toEqual({ state: "idle", latest, requestedAt: NOW - 3 * MIN, nextRequestAt: NOW - MIN + BACKUP_MIN_INTERVAL_MS });
  });

  it("ingen ny export inom tidsgränsen: misslyckad", () => {
    expect(backupStatus(null, requestAt(NOW - BACKUP_TIMEOUT_MS), NOW).state).toBe("failed");
  });

  it("nästa begäran räknas från det senaste av begäran och exporten", () => {
    expect(backupStatus(exportAt(NOW - 5 * MIN), null, NOW).nextRequestAt).toBe(NOW - 5 * MIN + BACKUP_MIN_INTERVAL_MS);
  });
});

describe("assertMayRequest", () => {
  it("vägrar medan en backup pågår", () => {
    expect(() => assertMayRequest(backupStatus(null, requestAt(NOW - MIN), NOW), NOW)).toThrow("En backup pågår redan.");
  });

  it("vägrar inom tio minuter efter förra backupen och säger hur länge", () => {
    const status = backupStatus(exportAt(NOW - 3 * MIN), null, NOW);
    expect(() => assertMayRequest(status, NOW)).toThrow(/om 7 min/);
  });

  it("tar emot när förra är gammal nog, och efter en misslyckad", () => {
    expect(() => assertMayRequest(backupStatus(exportAt(NOW - BACKUP_MIN_INTERVAL_MS), null, NOW), NOW)).not.toThrow();
    expect(() => assertMayRequest(backupStatus(null, requestAt(NOW - BACKUP_TIMEOUT_MS), NOW), NOW)).not.toThrow();
  });
});
