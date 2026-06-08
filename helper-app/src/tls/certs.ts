/**
 * Lokal CA + leaf-cert för helper-HTTPS (#102, ADR 0006).
 *
 * Nyckel-generering sker med node:crypto (snabb native RSA); cert-bygge +
 * signering med node-forge (ren JS, ingen system-openssl). CA:n utfärdas
 * med X.509 Name Constraints begränsade till localhost/127.0.0.1/::1 → en
 * läckt CA-nyckel kan inte förfalska cert för riktiga domäner.
 *
 * Material lagras i data-dir; nycklar med 0600. Idempotent: återanvänder
 * giltig CA + leaf, återutfärdar leaf när den närmar sig utgång.
 */

import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import forge from "node-forge";

const DAY_MS = 24 * 60 * 60 * 1000;
const CA_VALID_MS = 3650 * DAY_MS; // ~10 år
const LEAF_VALID_MS = 365 * DAY_MS;
const LEAF_RENEW_BEFORE_MS = 30 * DAY_MS;
const CLOCK_SKEW_MS = 60 * 1000;

export interface CertPair {
  /** PEM. */
  cert: string;
  /** PEM (PKCS#8). */
  key: string;
}
export interface TlsMaterial {
  ca: CertPair;
  leaf: CertPair;
}

function newKey(): { priv: forge.pki.rsa.PrivateKey; pub: forge.pki.rsa.PublicKey; keyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return {
    priv: forge.pki.privateKeyFromPem(privateKey),
    pub: forge.pki.publicKeyFromPem(publicKey),
    keyPem: privateKey,
  };
}

function serial(): string {
  // Inled med "00" så serien tolkas som positiv (icke-negativ INTEGER).
  return `00${randomBytes(8).toString("hex")}`;
}

/** GeneralName [2] dNSName (primitiv, IA5String). */
function dnsName(name: string): forge.asn1.Asn1 {
  return forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 2, false, name);
}

/** GeneralName [7] iPAddress för Name Constraints: adress-bytes + full mask. */
function ipNameConstraint(addr: readonly number[]): forge.asn1.Asn1 {
  const bytes = [...addr, ...addr.map(() => 0xff)];
  return forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 7, false, String.fromCharCode(...bytes));
}

function subtree(generalName: forge.asn1.Asn1): forge.asn1.Asn1 {
  return forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [generalName]);
}

const LOOPBACK_V6 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];

/** X.509 Name Constraints: tillåt ENDAST localhost / 127.0.0.1 / ::1. */
function nameConstraintsExtension(): { id: string; critical: boolean; value: string } {
  const permitted = forge.asn1.create(forge.asn1.Class.CONTEXT_SPECIFIC, 0, true, [
    subtree(dnsName("localhost")),
    subtree(ipNameConstraint([127, 0, 0, 1])),
    subtree(ipNameConstraint(LOOPBACK_V6)),
  ]);
  const nc = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [permitted]);
  return { id: "2.5.29.30", critical: true, value: forge.asn1.toDer(nc).getBytes() };
}

const CA_ATTRS = [{ name: "commonName", value: "AVA Helper Local CA" }];

/** Generera en self-signed, name-constrained lokal CA. */
export function generateCa(now: Date = new Date()): CertPair {
  const { priv, pub, keyPem } = newKey();
  const cert = forge.pki.createCertificate();
  cert.publicKey = pub;
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(now.getTime() - CLOCK_SKEW_MS);
  cert.validity.notAfter = new Date(now.getTime() + CA_VALID_MS);
  cert.setSubject(CA_ATTRS);
  cert.setIssuer(CA_ATTRS);
  cert.setExtensions([
    { name: "basicConstraints", cA: true, critical: true },
    { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
    nameConstraintsExtension(),
  ]);
  cert.sign(priv, forge.md.sha256.create());
  return { cert: forge.pki.certificateToPem(cert), key: keyPem };
}

/** Utfärda ett leaf-cert för localhost/127.0.0.1/::1, signerat av CA:n. */
export function issueLeaf(ca: CertPair, now: Date = new Date()): CertPair {
  const caCert = forge.pki.certificateFromPem(ca.cert);
  const caKey = forge.pki.privateKeyFromPem(ca.key);
  const { pub, keyPem } = newKey();
  const cert = forge.pki.createCertificate();
  cert.publicKey = pub;
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(now.getTime() - CLOCK_SKEW_MS);
  cert.validity.notAfter = new Date(now.getTime() + LEAF_VALID_MS);
  cert.setSubject([{ name: "commonName", value: "localhost" }]);
  cert.setIssuer(caCert.subject.attributes);
  cert.setExtensions([
    { name: "basicConstraints", cA: false, critical: true },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
    { name: "extKeyUsage", serverAuth: true },
    {
      name: "subjectAltName",
      altNames: [
        { type: 2, value: "localhost" },
        { type: 7, ip: "127.0.0.1" },
        { type: 7, ip: "::1" },
      ],
    },
  ]);
  cert.sign(caKey, forge.md.sha256.create());
  return { cert: forge.pki.certificateToPem(cert), key: keyPem };
}

function notAfter(certPem: string): number {
  return forge.pki.certificateFromPem(certPem).validity.notAfter.getTime();
}

function leafIssuedBy(leafPem: string, caPem: string): boolean {
  const leaf = forge.pki.certificateFromPem(leafPem);
  const ca = forge.pki.certificateFromPem(caPem);
  return leaf.issuer.hash === ca.subject.hash;
}

function readPair(certPath: string, keyPath: string): CertPair | null {
  try {
    return { cert: readFileSync(certPath, "utf8"), key: readFileSync(keyPath, "utf8") };
  } catch {
    return null;
  }
}

function writePair(certPath: string, keyPath: string, pair: CertPair): void {
  writeFileSync(certPath, pair.cert, { mode: 0o644 });
  writeFileSync(keyPath, pair.key, { mode: 0o600 });
}

/**
 * Ladda befintligt TLS-material från `dir`, eller generera + persistera.
 * CA återanvänds (långlivad); leaf återutfärdas om den saknas, snart går ut,
 * eller inte längre är signerad av aktuell CA.
 */
export function loadOrCreateTls(dir: string, now: Date = new Date()): TlsMaterial {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const caCertPath = join(dir, "ca.pem");
  const caKeyPath = join(dir, "ca-key.pem");
  const leafCertPath = join(dir, "leaf.pem");
  const leafKeyPath = join(dir, "leaf-key.pem");

  let ca = readPair(caCertPath, caKeyPath);
  if (ca === null || notAfter(ca.cert) <= now.getTime()) {
    ca = generateCa(now);
    writePair(caCertPath, caKeyPath, ca);
  }

  let leaf = readPair(leafCertPath, leafKeyPath);
  const stale = leaf !== null && notAfter(leaf.cert) - now.getTime() < LEAF_RENEW_BEFORE_MS;
  if (leaf === null || stale || !leafIssuedBy(leaf.cert, ca.cert)) {
    leaf = issueLeaf(ca, now);
    writePair(leafCertPath, leafKeyPath, leaf);
  }

  return { ca, leaf };
}
