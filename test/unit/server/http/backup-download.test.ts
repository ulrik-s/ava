/**
 * `GET /api/backup/download` (#1431): bara inloggade administratörer, bara
 * exporternas namn, strömmad som bilaga, och varje nedladdning loggas.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest-compat";
import type { Principal } from "@/lib/server/auth/principal";
import { handleBackupDownload, type BackupDownloadDeps } from "@/lib/server/http/backup-download";
import type { IBackupStore } from "@/lib/server/ports";
import { BACKUP_DOWNLOAD_PATH, backupDownloadUrl, backupFileNameSchema } from "@/lib/shared/backup";
import { nullSink, setLogSink, type LogRecord } from "@/lib/shared/observability/logger";
import { asId } from "@/lib/shared/schemas/ids";

const NAME = backupFileNameSchema.parse("ava-2026-10-01-0300.tar.age");
const BYTES = "age-encryption.org/v1 …chiffer…";

function principal(role: Principal["role"]): Principal {
  return { id: asId<"UserId">("u-1"), email: "a@byra.se", name: "A", role, organizationId: asId<"OrganizationId">("org-1") };
}

function store(): IBackupStore & { opened: string[] } {
  const opened: string[] = [];
  return {
    opened,
    latestExport: async () => null,
    readRequest: async () => null,
    writeRequest: async () => undefined,
    openExport: async (name) => {
      opened.push(name);
      return name === NAME ? { sizeBytes: Buffer.byteLength(BYTES), body: new Response(BYTES).body ?? new ReadableStream() } : null;
    },
  };
}

function deps(who: Principal | null, backup: IBackupStore | undefined = store()): BackupDownloadDeps {
  return { backup, principalFor: async () => who };
}

const get = (path: string, method = "GET") => new Request(`http://ava.test${path}`, { method });

const logged: LogRecord[] = [];
beforeEach(() => { logged.length = 0; setLogSink((r) => { logged.push(r); }); });
afterEach(() => { setLogSink(nullSink); });

describe("handleBackupDownload", () => {
  it("andra sökvägar lämnas vidare (null)", async () => {
    expect(await handleBackupDownload(get("/api/trpc/x"), deps(principal("ADMIN")))).toBeNull();
  });

  it("strömmar exporten som bilaga till en administratör och loggar nedladdningen", async () => {
    const res = await handleBackupDownload(get(backupDownloadUrl(NAME)), deps(principal("ADMIN")));
    expect(res?.status).toBe(200);
    expect(res?.headers.get("content-type")).toBe("application/octet-stream");
    expect(res?.headers.get("content-disposition")).toBe(`attachment; filename="${NAME}"`);
    expect(res?.headers.get("content-length")).toBe(String(Buffer.byteLength(BYTES)));
    expect(res?.headers.get("cache-control")).toBe("no-store");
    expect(await res?.text()).toBe(BYTES);
    expect(logged.find((r) => r.event === "backup.downloaded")).toMatchObject({ userId: "u-1", orgId: "org-1", ids: [NAME] });
  });

  it("bara GET", async () => {
    expect((await handleBackupDownload(get(backupDownloadUrl(NAME), "POST"), deps(principal("ADMIN"))))?.status).toBe(405);
  });

  it("utan inloggning: 401; inte administratör: 403 — filen öppnas aldrig", async () => {
    const s = store();
    expect((await handleBackupDownload(get(backupDownloadUrl(NAME)), deps(null, s)))?.status).toBe(401);
    expect((await handleBackupDownload(get(backupDownloadUrl(NAME)), deps(principal("LAWYER"), s)))?.status).toBe(403);
    expect(s.opened).toEqual([]);
    expect(logged.some((r) => r.event === "backup.downloaded")).toBe(false);
  });

  it("namn som inte är en export (t.ex. sökvägar) vägras med 400", async () => {
    const s = store();
    for (const bad of ["../../etc/passwd", "ava-2026-10-01-0300.tar.age.sha256", ""]) {
      const res = await handleBackupDownload(get(`${BACKUP_DOWNLOAD_PATH}?name=${encodeURIComponent(bad)}`), deps(principal("ADMIN"), s));
      expect(res?.status).toBe(400);
    }
    expect((await handleBackupDownload(get(BACKUP_DOWNLOAD_PATH), deps(principal("ADMIN"), s)))?.status).toBe(400);
    expect(s.opened).toEqual([]);
  });

  it("en export som inte finns: 404", async () => {
    const other = backupFileNameSchema.parse("ava-2026-09-01-0300.tar.age");
    expect((await handleBackupDownload(get(backupDownloadUrl(other)), deps(principal("ADMIN"))))?.status).toBe(404);
  });

  it("servern utan backup på begäran: 404", async () => {
    expect((await handleBackupDownload(get(backupDownloadUrl(NAME)), { backup: undefined, principalFor: async () => principal("ADMIN") }))?.status).toBe(404);
  });
});
