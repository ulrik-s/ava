import { X509Certificate } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";

import forge from "node-forge";

import { generateCa, issueLeaf, loadOrCreateTls } from "../src/tls/certs.ts";

const NAME_CONSTRAINTS_OID = "2.5.29.30";

function nameConstraintsExt(certPem: string): { critical?: boolean } | undefined {
  return forge.pki
    .certificateFromPem(certPem)
    .extensions.find((e: { id: string }) => e.id === NAME_CONSTRAINTS_OID);
}

describe("generateCa", () => {
  const ca = generateCa();

  test("är en CA-root med rätt subject", () => {
    const x = new X509Certificate(ca.cert);
    expect(x.ca).toBe(true);
    expect(x.subject).toContain("AVA Helper Local CA");
  });

  test("har kritiska Name Constraints (härdning)", () => {
    const nc = nameConstraintsExt(ca.cert);
    expect(nc).toBeDefined();
    expect(nc?.critical).toBe(true);
  });

  test("nyckel-PEM är PKCS#8", () => {
    expect(ca.key).toContain("BEGIN PRIVATE KEY");
  });
});

describe("issueLeaf", () => {
  const ca = generateCa();
  const leaf = issueLeaf(ca);
  const leafX = new X509Certificate(leaf.cert);

  test("SAN täcker localhost + 127.0.0.1 + ::1", () => {
    expect(leafX.checkHost("localhost")).toBe("localhost");
    expect(leafX.checkIP("127.0.0.1")).toBe("127.0.0.1");
    expect(leafX.subjectAltName).toContain("localhost");
  });

  test("är signerad av CA:n", () => {
    const caX = new X509Certificate(ca.cert);
    expect(leafX.verify(caX.publicKey)).toBe(true);
  });

  test("är inte själv en CA", () => {
    expect(leafX.ca).toBe(false);
  });
});

describe("loadOrCreateTls", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  });
  async function freshDir(): Promise<string> {
    const d = await mkdtemp(join(tmpdir(), "ava-tls-"));
    dirs.push(d);
    return join(d, "tls");
  }

  test("skapar CA + leaf och persisterar (nyckel 0600)", async () => {
    const dir = await freshDir();
    const m = loadOrCreateTls(dir);
    expect(m.ca.cert).toContain("BEGIN CERTIFICATE");
    expect(m.leaf.cert).toContain("BEGIN CERTIFICATE");
    const mode = (await stat(join(dir, "leaf-key.pem"))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("är idempotent — återanvänder befintligt material", async () => {
    const dir = await freshDir();
    const a = loadOrCreateTls(dir);
    const b = loadOrCreateTls(dir);
    expect(b.ca.cert).toBe(a.ca.cert);
    expect(b.leaf.cert).toBe(a.leaf.cert);
  });

  test("återutfärdar leaf nära utgång men behåller CA", async () => {
    const dir = await freshDir();
    const t0 = new Date("2026-01-01T00:00:00Z");
    const first = loadOrCreateTls(dir, t0);
    // 350 dagar senare: leaf (1 år) inom 30-dagars förnyelsefönster.
    const later = new Date(t0.getTime() + 350 * 24 * 60 * 60 * 1000);
    const second = loadOrCreateTls(dir, later);
    expect(second.ca.cert).toBe(first.ca.cert); // CA långlivad, oförändrad
    expect(second.leaf.cert).not.toBe(first.leaf.cert); // leaf återutfärdad
  });
});

describe("cert-egenskaper", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const ca = generateCa(now);
  const leaf = issueLeaf(ca, now);
  const years = (ms: number): number => ms / (365 * 24 * 60 * 60 * 1000);

  test("leaf har serverAuth EKU", () => {
    // node X509Certificate.keyUsage exponerar extended key usage-OID:erna.
    expect(new X509Certificate(leaf.cert).keyUsage).toContain("1.3.6.1.5.5.7.3.1");
  });

  test("giltighetsfönster: CA långlivad (~10 år), leaf kortlivad (~1 år)", () => {
    const caTo = new X509Certificate(ca.cert).validToDate.getTime();
    const leafTo = new X509Certificate(leaf.cert).validToDate.getTime();
    expect(years(caTo - now.getTime())).toBeGreaterThan(9);
    expect(years(leafTo - now.getTime())).toBeGreaterThan(0.9);
    expect(years(leafTo - now.getTime())).toBeLessThan(1.1);
  });
});
