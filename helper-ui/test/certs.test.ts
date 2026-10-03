import { createPrivateKey, X509Certificate } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { request, createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AsnConvert } from "@peculiar/asn1-schema";
import { Certificate, NameConstraints, id_ce_nameConstraints } from "@peculiar/asn1-x509";
import { afterAll, describe, expect, test } from "bun:test";

import { CA_COMMON_NAME, generateCa, issueLeaf, loadOrCreateTls, type CertPair } from "../src/engine/tls/certs.ts";
import {
  LEGACY_CA_CERT,
  LEGACY_CA_KEY,
  LEGACY_LEAF_CERT,
  LEGACY_LEAF_KEY,
  LEGACY_NOW,
} from "./fixtures/legacy-forge-tls.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const LEGACY_CA: CertPair = { cert: LEGACY_CA_CERT, key: LEGACY_CA_KEY };

function parse(certPem: string): Certificate {
  return AsnConvert.parse(new X509Certificate(certPem).raw, Certificate);
}

function nameConstraints(certPem: string): { critical: boolean; value: NameConstraints } | undefined {
  const ext = parse(certPem).tbsCertificate.extensions?.find((e) => e.extnID === id_ce_nameConstraints);
  return ext && { critical: ext.critical, value: AsnConvert.parse(ext.extnValue, NameConstraints) };
}

/** DER för issuer-namnet i `leaf` resp. subject-namnet i `ca`. */
function issuerAndCaSubject(leaf: string, ca: string): [string, string] {
  const der = (n: unknown): string => Buffer.from(AsnConvert.serialize(n)).toString("hex");
  return [der(parse(leaf).tbsCertificate.issuer), der(parse(ca).tbsCertificate.subject)];
}

/**
 * Riktig TLS-handskakning: https-server med leaf-certet, klient som ENDAST litar
 * på `caPem` (inga system-rötter). Löser med HTTP-status eller avvisar med felet.
 */
async function handshake(leaf: CertPair, caPem: string, servername?: string): Promise<number> {
  const server = createServer({ cert: leaf.cert, key: leaf.key }, (_req, res) => res.end("ok"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (addr === null || typeof addr === "string") throw new Error("ingen TCP-adress");
  const { port } = addr;
  try {
    return await new Promise<number>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, ca: caPem, servername, path: "/" }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end();
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("generateCa", () => {
  const ca = generateCa();
  const x = new X509Certificate(ca.cert);

  test("är en self-signed CA-root med rätt subject", () => {
    expect(x.ca).toBe(true);
    expect(x.subject).toBe(`CN=${CA_COMMON_NAME}`);
    expect(x.issuer).toBe(`CN=${CA_COMMON_NAME}`);
    expect(x.verify(x.publicKey)).toBe(true);
  });

  test("har kritiska Name Constraints: bara dNSName localhost tillåts", () => {
    const nc = nameConstraints(ca.cert);
    expect(nc?.critical).toBe(true);
    expect(nc?.value.permittedSubtrees?.map((s) => s.base.dNSName)).toEqual(["localhost"]);
    expect(nc?.value.excludedSubtrees).toBeUndefined();
  });

  test("basicConstraints CA + keyUsage keyCertSign/cRLSign, båda kritiska", () => {
    const exts = parse(ca.cert).tbsCertificate.extensions ?? [];
    const critical = exts.filter((e) => e.critical).map((e) => e.extnID);
    expect(critical).toEqual(["2.5.29.19", "2.5.29.15", "2.5.29.30"]);
    // Samma DER som forge-CA:erna: KeyUsage-bitarna 5+6 → 03 02 01 06.
    expect(Buffer.from(exts[1]?.extnValue.buffer ?? new ArrayBuffer(0)).toString("hex")).toBe("03020106");
  });

  test("RSA-2048, sha256WithRSAEncryption, positivt serienummer", () => {
    expect(x.publicKey.asymmetricKeyType).toBe("rsa");
    expect(x.publicKey.asymmetricKeyDetails?.modulusLength).toBe(2048);
    expect(parse(ca.cert).signatureAlgorithm.algorithm).toBe("1.2.840.113549.1.1.11");
    expect(Number.parseInt(x.serialNumber.slice(0, 2), 16)).toBeLessThan(0x80);
  });

  test("nyckel-PEM är PKCS#8 och hör till certet", () => {
    expect(ca.key).toContain("BEGIN PRIVATE KEY");
    expect(x.checkPrivateKey(createPrivateKey(ca.key))).toBe(true);
  });
});

describe("issueLeaf", () => {
  const ca = generateCa();
  const leaf = issueLeaf(ca);
  const leafX = new X509Certificate(leaf.cert);
  const caX = new X509Certificate(ca.cert);

  test("SAN täcker localhost + 127.0.0.1 + ::1", () => {
    expect(leafX.checkHost("localhost")).toBe("localhost");
    expect(leafX.checkIP("127.0.0.1")).toBe("127.0.0.1");
    expect(leafX.checkIP("::1")).toBe("::1");
    expect(leafX.subjectAltName).toBe("DNS:localhost, IP Address:127.0.0.1, IP Address:0:0:0:0:0:0:0:1");
  });

  test("är signerad av CA:n och har CA:ns subject som issuer", () => {
    expect(leafX.subject).toBe("CN=localhost");
    expect(leafX.issuer).toBe(caX.subject);
    expect(leafX.verify(caX.publicKey)).toBe(true);
  });

  test("är inte själv en CA och saknar Name Constraints", () => {
    expect(leafX.ca).toBe(false);
    expect(nameConstraints(leaf.cert)).toBeUndefined();
  });

  test("nyckeln hör till leaf-certet", () => {
    expect(leafX.checkPrivateKey(createPrivateKey(leaf.key))).toBe(true);
  });
});

describe("TLS-handskakning (node:https)", () => {
  const ca = generateCa();
  const leaf = issueLeaf(ca);

  test("klient som litar på CA:n når servern via localhost (DNS-SAN, name constraints)", async () => {
    expect(await handshake(leaf, ca.cert, "localhost")).toBe(200);
  });

  test("klient som litar på CA:n når servern via 127.0.0.1 (IP-SAN)", async () => {
    expect(await handshake(leaf, ca.cert)).toBe(200);
  });

  test("klient som litar på en ANNAN CA avvisar certet", async () => {
    await expect(handshake(leaf, generateCa().cert, "localhost")).rejects.toThrow();
  });
});

describe("befintliga installationer (forge-genererad CA)", () => {
  test("ny leaf under den gamla CA:n: issuer-namnet kopieras byte för byte", () => {
    const leaf = issueLeaf(LEGACY_CA);
    const [issuer, caSubject] = issuerAndCaSubject(leaf.cert, LEGACY_CA_CERT);
    expect(issuer).toBe(caSubject);
    const leafX = new X509Certificate(leaf.cert);
    const caX = new X509Certificate(LEGACY_CA_CERT);
    expect(leafX.verify(caX.publicKey)).toBe(true);
  });

  test("TLS fungerar med den gamla CA:n som enda betrodda rot", async () => {
    expect(await handshake(issueLeaf(LEGACY_CA), LEGACY_CA_CERT, "localhost")).toBe(200);
  });

  test("ny kod genererar samma subject-kodning som forge (PrintableString)", () => {
    const [, legacySubject] = issuerAndCaSubject(LEGACY_LEAF_CERT, LEGACY_CA_CERT);
    const [, newSubject] = issuerAndCaSubject(LEGACY_LEAF_CERT, generateCa().cert);
    expect(newSubject).toBe(legacySubject);
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
    expect((await stat(join(dir, "leaf-key.pem"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, "ca-key.pem"))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(dir, "ca.pem"), "utf8")).toBe(m.ca.cert);
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
    const second = loadOrCreateTls(dir, new Date(t0.getTime() + 350 * DAY_MS));
    expect(second.ca.cert).toBe(first.ca.cert); // CA långlivad, oförändrad
    expect(second.leaf.cert).not.toBe(first.leaf.cert); // leaf återutfärdad
  });

  test("återskapar CA (och leaf) när CA:n gått ut", async () => {
    const dir = await freshDir();
    const t0 = new Date("2026-01-01T00:00:00Z");
    const first = loadOrCreateTls(dir, t0);
    const second = loadOrCreateTls(dir, new Date(t0.getTime() + 3651 * DAY_MS));
    expect(second.ca.cert).not.toBe(first.ca.cert);
    expect(new X509Certificate(second.leaf.cert).verify(new X509Certificate(second.ca.cert).publicKey)).toBe(true);
  });

  test("återutfärdar leaf som signerats av en annan CA med samma namn", async () => {
    const dir = await freshDir();
    const first = loadOrCreateTls(dir);
    const foreign = issueLeaf(generateCa()); // samma CN, annan nyckel
    await writeFile(join(dir, "leaf.pem"), foreign.cert);
    await writeFile(join(dir, "leaf-key.pem"), foreign.key);
    const second = loadOrCreateTls(dir);
    expect(second.ca.cert).toBe(first.ca.cert);
    expect(second.leaf.cert).not.toBe(foreign.cert);
    expect(new X509Certificate(second.leaf.cert).verify(new X509Certificate(first.ca.cert).publicKey)).toBe(true);
  });

  test("befintlig forge-CA + leaf återanvänds orörda (ingen ny trust behövs)", async () => {
    const dir = await freshDir();
    loadOrCreateTls(dir); // skapa katalogen
    await writeFile(join(dir, "ca.pem"), LEGACY_CA_CERT);
    await writeFile(join(dir, "ca-key.pem"), LEGACY_CA_KEY);
    await writeFile(join(dir, "leaf.pem"), LEGACY_LEAF_CERT);
    await writeFile(join(dir, "leaf-key.pem"), LEGACY_LEAF_KEY);
    const m = loadOrCreateTls(dir, LEGACY_NOW);
    expect(m.ca.cert).toBe(LEGACY_CA_CERT);
    expect(m.leaf.cert).toBe(LEGACY_LEAF_CERT);
    // Ett år senare förnyas leafen — fortfarande under den gamla CA:n.
    const later = loadOrCreateTls(dir, new Date(LEGACY_NOW.getTime() + 350 * DAY_MS));
    expect(later.ca.cert).toBe(LEGACY_CA_CERT);
    expect(later.leaf.cert).not.toBe(LEGACY_LEAF_CERT);
    expect(new X509Certificate(later.leaf.cert).verify(new X509Certificate(LEGACY_CA_CERT).publicKey)).toBe(true);
  });
});

describe("cert-egenskaper", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const ca = generateCa(now);
  const leaf = issueLeaf(ca, now);
  const years = (ms: number): number => ms / (365 * DAY_MS);

  test("leaf har serverAuth EKU", () => {
    // node X509Certificate.keyUsage exponerar extended key usage-OID:erna.
    expect(new X509Certificate(leaf.cert).keyUsage).toEqual(["1.3.6.1.5.5.7.3.1"]);
  });

  test("giltighetsfönster: CA ~10 år, leaf ~1 år, båda med 60 s klock-marginal bakåt", () => {
    const caX = new X509Certificate(ca.cert);
    const leafX = new X509Certificate(leaf.cert);
    expect(caX.validFromDate.getTime()).toBe(now.getTime() - 60_000);
    expect(leafX.validFromDate.getTime()).toBe(now.getTime() - 60_000);
    expect(caX.validToDate.getTime()).toBe(now.getTime() + 3650 * DAY_MS);
    expect(years(leafX.validToDate.getTime() - now.getTime())).toBe(1);
  });
});
