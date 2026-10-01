/**
 * `FsBackupStore` (#1431) mot riktiga kataloger: nyaste exporten, checksumman,
 * begärandefilen (atomärt) och strömningen — utan att följa symlänkar.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest-compat";
import {
  BACKUP_ENV, BACKUP_REQUEST_FILE, backupDirsFromEnv, fileStream, FsBackupStore, newestExportName, parseBackupRequest, parseSha256File,
} from "@/lib/server/backup/fs-backup-store";
import { backupFileNameSchema } from "@/lib/shared/backup";

const SHA = "b".repeat(64);
const name = (s: string) => backupFileNameSchema.parse(s);

let root: string;
let exportDir: string;
let requestDir: string;
let store: FsBackupStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ava-backup-"));
  exportDir = join(root, "exports");
  requestDir = join(root, "requests");
  mkdirSync(exportDir);
  mkdirSync(requestDir);
  store = new FsBackupStore({ exportDir, requestDir });
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

async function readAll(body: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(body).text();
}

describe("rena delar", () => {
  it("nyaste exporten ur namnen; annat ignoreras", () => {
    expect(newestExportName(["ava-2026-09-30-0300.tar.age", ".ava-2026-10-02-0300.tar.age", "ava-2026-10-01-0300.tar.age.sha256", "ava-2026-10-01-0300.tar.age", "x"]))
      .toBe("ava-2026-10-01-0300.tar.age");
    expect(newestExportName(["annat"])).toBeNull();
  });

  it("checksumman ur sha256sum-raden", () => {
    expect(parseSha256File(`${SHA}  ava-2026-10-01-0300.tar.age\n`)).toBe(SHA);
    expect(parseSha256File("inte en summa")).toBeNull();
  });

  it("begärandefilen: bara serverns form", () => {
    expect(parseBackupRequest(JSON.stringify({ requestId: "0190a3f0-0000-7000-8000-000000000001", requestedAt: 5 })))
      .toEqual({ requestId: "0190a3f0-0000-7000-8000-000000000001", requestedAt: 5 });
    expect(parseBackupRequest(JSON.stringify({ requestId: "x", requestedAt: 5 }))).toBeNull();
    expect(parseBackupRequest("{trasig")).toBeNull();
  });

  it("katalogerna ur miljön — båda krävs", () => {
    expect(backupDirsFromEnv({ [BACKUP_ENV.exportDir]: "/e", [BACKUP_ENV.requestDir]: "/r" })).toEqual({ exportDir: "/e", requestDir: "/r" });
    expect(backupDirsFromEnv({ [BACKUP_ENV.exportDir]: "/e" })).toBeNull();
  });
});

describe("FsBackupStore", () => {
  it("ingen export, ingen begäran", async () => {
    expect(await store.latestExport()).toBeNull();
    expect(await store.readRequest()).toBeNull();
  });

  it("saknad exportkatalog = inga exporter", async () => {
    const missing = new FsBackupStore({ exportDir: join(root, "finns-inte"), requestDir });
    expect(await missing.latestExport()).toBeNull();
  });

  it("andra fel än 'finns inte' syns", async () => {
    const file = join(root, "en-fil");
    writeFileSync(file, "x");
    const broken = new FsBackupStore({ exportDir: file, requestDir: file });
    await expect(broken.latestExport()).rejects.toThrow();
    await expect(broken.readRequest()).rejects.toThrow();
  });

  it("nyaste exporten med storlek, tid och checksumma", async () => {
    writeFileSync(join(exportDir, "ava-2026-09-30-0300.tar.age"), "gammal");
    writeFileSync(join(exportDir, "ava-2026-10-01-0300.tar.age"), "krypterat-innehåll");
    writeFileSync(join(exportDir, "ava-2026-10-01-0300.tar.age.sha256"), `${SHA}  ava-2026-10-01-0300.tar.age\n`);
    const latest = await store.latestExport();
    expect(latest).toMatchObject({ name: "ava-2026-10-01-0300.tar.age", sizeBytes: Buffer.byteLength("krypterat-innehåll"), sha256: SHA });
    expect(latest?.createdAt).toBeGreaterThan(Date.now() - 60_000);
  });

  it("utan checksumfil: sha256 null", async () => {
    writeFileSync(join(exportDir, "ava-2026-10-01-0300.tar.age"), "x");
    expect((await store.latestExport())?.sha256).toBeNull();
  });

  it("en symlänk eller katalog med exportens namn räknas inte", async () => {
    writeFileSync(join(root, "hemlig"), "inte en backup");
    symlinkSync(join(root, "hemlig"), join(exportDir, "ava-2026-10-01-0300.tar.age"));
    mkdirSync(join(exportDir, "ava-2026-10-02-0300.tar.age"));
    expect(await store.latestExport()).toBeNull();
    expect(await store.openExport(name("ava-2026-10-01-0300.tar.age"))).toBeNull();
    expect(await store.openExport(name("ava-2026-10-02-0300.tar.age"))).toBeNull();
  });

  it("begäran skrivs atomärt och läses tillbaka; ingen tempfil blir kvar", async () => {
    const request = { requestId: "0190a3f0-0000-7000-8000-000000000001", requestedAt: 1234 };
    await store.writeRequest(request);
    expect(await store.readRequest()).toEqual(request);
    expect(readdirSync(requestDir)).toEqual([BACKUP_REQUEST_FILE]);
    expect(JSON.parse(readFileSync(join(requestDir, BACKUP_REQUEST_FILE), "utf8"))).toEqual(request);
  });

  it("öppnar en export för strömning", async () => {
    writeFileSync(join(exportDir, "ava-2026-10-01-0300.tar.age"), "abcdef");
    const file = await store.openExport(name("ava-2026-10-01-0300.tar.age"));
    expect(file?.sizeBytes).toBe(6);
    expect(file ? await readAll(file.body) : null).toBe("abcdef");
  });

  it("en export som inte finns: null", async () => {
    expect(await store.openExport(name("ava-2026-10-01-0300.tar.age"))).toBeNull();
  });
});

describe("fileStream", () => {
  it("läser i bitar och stänger filen när den är slut", async () => {
    const path = join(root, "f");
    writeFileSync(path, "0123456789");
    const handle = await open(path, "r");
    expect(await readAll(fileStream(handle, 3))).toBe("0123456789");
    await expect(handle.stat()).rejects.toThrow();
  });

  it("avbryten ström stänger filen", async () => {
    const path = join(root, "f");
    writeFileSync(path, "0123456789");
    const handle = await open(path, "r");
    const reader = fileStream(handle, 2).getReader();
    await reader.read();
    await reader.cancel();
    await expect(handle.stat()).rejects.toThrow();
  });

  it("läsfel blir ett fel i strömmen", async () => {
    const path = join(root, "f");
    writeFileSync(path, "x");
    const handle = await open(path, "r");
    await handle.close();
    await expect(readAll(fileStream(handle))).rejects.toThrow();
  });
});
