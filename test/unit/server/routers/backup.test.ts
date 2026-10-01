/**
 * `backup.status` / `backup.request` (#1431): bara administratörer, en
 * begäran åt gången, inte oftare än var tionde minut, och varje begäran loggas.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest-compat";
import { BACKUP_MIN_INTERVAL_MS } from "@/lib/server/backup/backup-state";
import type { BackupRequest, IBackupStore } from "@/lib/server/ports";
import { backupRouter } from "@/lib/server/routers/backup";
import { backupFileNameSchema, type BackupExport } from "@/lib/shared/backup";
import { setLogSink, nullSink, type LogRecord } from "@/lib/shared/observability/logger";
import { asId } from "@/lib/shared/schemas/ids";

const MIN = 60_000;

function fakeStore(latest: BackupExport | null = null, request: BackupRequest | null = null) {
  const written: BackupRequest[] = [];
  const store: IBackupStore = {
    latestExport: async () => latest,
    readRequest: async () => written.at(-1) ?? request,
    writeRequest: async (r) => { written.push(r); },
    openExport: async () => null,
  };
  return { store, written };
}

function exportAt(createdAt: number): BackupExport {
  return { name: backupFileNameSchema.parse("ava-2026-10-01-0300.tar.age"), sizeBytes: 10, createdAt, sha256: null };
}

function caller(role: string, store?: IBackupStore) {
  const ctx = {
    user: { id: asId<"UserId">("u-1"), email: "a@byra.se", name: "A", role, organizationId: asId<"OrganizationId">("org-1") },
    requestId: "req-1",
    ports: store ? { backup: store } : {},
  };
  // Minimal kontext: routern rör bara user, ports.backup och requestId.
  return backupRouter.createCaller(ctx as never);
}

const logged: LogRecord[] = [];
beforeEach(() => { logged.length = 0; setLogSink((r) => { logged.push(r); }); });
afterEach(() => { setLogSink(nullSink); });

describe("backup — behörighet", () => {
  it("bara administratörer", async () => {
    const { store } = fakeStore();
    await expect(caller("LAWYER", store).status()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("LAWYER", store).request()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("utan backupport (webbläsaren, eller servern utan katalogerna): NOT_IMPLEMENTED", async () => {
    await expect(caller("ADMIN").status()).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
    await expect(caller("ADMIN").request()).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
  });
});

describe("backup.status", () => {
  it("läget ur porten", async () => {
    const latest = exportAt(Date.now() - 30 * MIN);
    expect(await caller("ADMIN", fakeStore(latest).store).status()).toMatchObject({ state: "idle", latest, requestedAt: null });
  });
});

describe("backup.request", () => {
  it("lägger en begäran, svarar 'pågår' och loggar bara id:n", async () => {
    const { store, written } = fakeStore(exportAt(Date.now() - BACKUP_MIN_INTERVAL_MS - MIN));
    const status = await caller("ADMIN", store).request();
    expect(written).toHaveLength(1);
    expect(written[0]?.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(status).toMatchObject({ state: "running", requestedAt: written[0]?.requestedAt });
    const audit = logged.find((r) => r.event === "backup.requested");
    expect(audit).toMatchObject({ userId: "u-1", orgId: "org-1", ids: [written[0]?.requestId], requestId: "req-1" });
  });

  it("vägras medan en backup pågår", async () => {
    const { store, written } = fakeStore(null, { requestId: "0190a3f0-0000-7000-8000-000000000001", requestedAt: Date.now() - MIN });
    await expect(caller("ADMIN", store).request()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(written).toHaveLength(0);
  });

  it("vägras när förra backupen är färskare än tio minuter", async () => {
    const { store, written } = fakeStore(exportAt(Date.now() - 2 * MIN));
    await expect(caller("ADMIN", store).request()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(written).toHaveLength(0);
  });

  it("en andra begäran direkt efter den första vägras", async () => {
    const { store } = fakeStore();
    await caller("ADMIN", store).request();
    await expect(caller("ADMIN", store).request()).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
