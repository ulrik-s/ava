/**
 * Lokal CA + leaf-cert för helper-HTTPS (#102, ADR 0006).
 *
 * Nyckel-generering och RSA-signering sker med node:crypto (native, synkront);
 * själva X.509-strukturen byggs och DER-kodas med `@peculiar/asn1-x509` (typade
 * ASN.1-scheman, ingen egen kryptografi). CA:n utfärdas med X.509 Name
 * Constraints begränsade till localhost → en läckt CA-nyckel kan inte förfalska
 * cert för riktiga domäner.
 *
 * Tidigare byggdes certen med node-forge, som har en olagad sårbarhet i sin
 * RSA-signaturverifiering (GHSA-86w9-cpqp-85rv). Formatet är detsamma: CN som
 * PrintableString, sha256WithRSAEncryption med NULL-parametrar, samma tillägg —
 * så CA:er som redan ligger i användarens nyckelring fortsätter att användas.
 *
 * Material lagras i data-dir; nycklar med 0600. Idempotent: återanvänder
 * giltig CA + leaf, återutfärdar leaf när den närmar sig utgång.
 */

import { createPrivateKey, generateKeyPairSync, randomBytes, sign, X509Certificate, type KeyObject } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { AsnConvert, OctetString } from "@peculiar/asn1-schema";
import {
  AlgorithmIdentifier,
  AttributeTypeAndValue,
  AttributeValue,
  BasicConstraints,
  Certificate,
  ExtendedKeyUsage,
  Extension,
  Extensions,
  GeneralName,
  GeneralSubtree,
  GeneralSubtrees,
  KeyUsage,
  KeyUsageFlags,
  Name,
  NameConstraints,
  RelativeDistinguishedName,
  SubjectAlternativeName,
  SubjectPublicKeyInfo,
  TBSCertificate,
  Validity,
  Version,
  id_ce_basicConstraints,
  id_ce_extKeyUsage,
  id_ce_keyUsage,
  id_ce_nameConstraints,
  id_ce_subjectAltName,
  id_kp_serverAuth,
} from "@peculiar/asn1-x509";

const DAY_MS = 24 * 60 * 60 * 1000;
const CA_VALID_MS = 3650 * DAY_MS; // ~10 år
const LEAF_VALID_MS = 365 * DAY_MS;
const LEAF_RENEW_BEFORE_MS = 30 * DAY_MS;
const CLOCK_SKEW_MS = 60 * 1000;

/** sha256WithRSAEncryption (RFC 4055). */
const SHA256_WITH_RSA = "1.2.840.113549.1.1.11";
/** id-at-commonName. */
const COMMON_NAME = "2.5.4.3";
/** DER för ASN.1 NULL — RSA-algoritmidentifierare ska bära explicit NULL. */
const DER_NULL = new Uint8Array([0x05, 0x00]).buffer;

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

interface NewKey {
  privateKey: KeyObject;
  spki: SubjectPublicKeyInfo;
  keyPem: string;
}

function newKey(): NewKey {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    privateKey,
    spki: AsnConvert.parse(publicKey.export({ type: "spki", format: "der" }), SubjectPublicKeyInfo),
    keyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

/** 16 slumpbytes; första byten utan teckenbit och ≠ 0 → positiv, minimal DER-INTEGER. */
function serial(): ArrayBuffer {
  const bytes = randomBytes(16);
  bytes[0] = ((bytes[0] ?? 0) & 0x7f) | 0x40;
  return new Uint8Array(bytes).buffer;
}

/** `CN=<cn>` som PrintableString (samma kodning som de forge-genererade certen). */
function commonName(cn: string): Name {
  const attr = new AttributeTypeAndValue({ type: COMMON_NAME, value: new AttributeValue({ printableString: cn }) });
  return new Name([new RelativeDistinguishedName([attr])]);
}

function extension(extnID: string, critical: boolean, value: unknown): Extension {
  return new Extension({ extnID, critical, extnValue: new OctetString(AsnConvert.serialize(value)) });
}

function keyUsage(flags: number): KeyUsage {
  const ku = new KeyUsage();
  ku.fromNumber(flags);
  return ku;
}

/**
 * X.509 Name Constraints: tillåt ENDAST dNSName `localhost`. Det säkrar det
 * kritiska — en läckt CA-nyckel kan inte signera cert för riktiga domäner
 * (*.com etc.). iPAddress-constraints utelämnas MEDVETET: BoringSSL (Bun) och
 * flera andra verifierare avvisar kedjan med "unsupported name constraint
 * type" på iPAddress-subtrees, vilket skulle bryta hela HTTPS-flödet. IP-SANs
 * (127.0.0.1/::1) blir därmed obegränsade, vilket är acceptabelt (domän-
 * förfalskning är den verkliga risken, inte loopback-IP).
 */
function nameConstraintsExtension(): Extension {
  const permitted = new GeneralSubtrees([new GeneralSubtree({ base: new GeneralName({ dNSName: "localhost" }) })]);
  return extension(id_ce_nameConstraints, true, new NameConstraints({ permittedSubtrees: permitted }));
}

interface CertSpec {
  issuer: Name;
  subject: Name;
  spki: SubjectPublicKeyInfo;
  signer: KeyObject;
  now: Date;
  validMs: number;
  extensions: Extension[];
}

/** Bygg TBSCertificate, signera med RSA-PKCS#1 v1.5/SHA-256 och returnera PEM. */
function buildCert(spec: CertSpec): string {
  const algorithm = new AlgorithmIdentifier({ algorithm: SHA256_WITH_RSA, parameters: DER_NULL });
  const tbsCertificate = new TBSCertificate({
    version: Version.v3,
    serialNumber: serial(),
    signature: algorithm,
    issuer: spec.issuer,
    validity: new Validity({
      notBefore: new Date(spec.now.getTime() - CLOCK_SKEW_MS),
      notAfter: new Date(spec.now.getTime() + spec.validMs),
    }),
    subject: spec.subject,
    subjectPublicKeyInfo: spec.spki,
    extensions: new Extensions(spec.extensions),
  });
  const tbs = new Uint8Array(AsnConvert.serialize(tbsCertificate));
  const signatureValue = new Uint8Array(sign("sha256", tbs, spec.signer)).buffer;
  const der = AsnConvert.serialize(new Certificate({ tbsCertificate, signatureAlgorithm: algorithm, signatureValue }));
  return new X509Certificate(new Uint8Array(der)).toString();
}

/** CN på den lokala CA:n — används av trust-install/-uninstall (#103). */
export const CA_COMMON_NAME = "AVA Helper Local CA";

/** Generera en self-signed, name-constrained lokal CA. */
export function generateCa(now: Date = new Date()): CertPair {
  const { privateKey, spki, keyPem } = newKey();
  const cert = buildCert({
    issuer: commonName(CA_COMMON_NAME),
    subject: commonName(CA_COMMON_NAME),
    spki,
    signer: privateKey,
    now,
    validMs: CA_VALID_MS,
    extensions: [
      extension(id_ce_basicConstraints, true, new BasicConstraints({ cA: true })),
      extension(id_ce_keyUsage, true, keyUsage(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign)),
      nameConstraintsExtension(),
    ],
  });
  return { cert, key: keyPem };
}

/**
 * Utfärda ett leaf-cert för localhost/127.0.0.1/::1, signerat av CA:n.
 * Utfärdarnamnet kopieras ur CA-certet (inte återskapat) så kedjan håller även
 * mot en äldre, redan betrodd CA.
 */
export function issueLeaf(ca: CertPair, now: Date = new Date()): CertPair {
  const caCert = AsnConvert.parse(new X509Certificate(ca.cert).raw, Certificate);
  const { spki, keyPem } = newKey();
  const san = new SubjectAlternativeName([
    new GeneralName({ dNSName: "localhost" }),
    new GeneralName({ iPAddress: "127.0.0.1" }),
    new GeneralName({ iPAddress: "::1" }),
  ]);
  const cert = buildCert({
    issuer: caCert.tbsCertificate.subject,
    subject: commonName("localhost"),
    spki,
    signer: createPrivateKey(ca.key),
    now,
    validMs: LEAF_VALID_MS,
    extensions: [
      extension(id_ce_basicConstraints, true, new BasicConstraints({ cA: false })),
      extension(id_ce_keyUsage, true, keyUsage(KeyUsageFlags.digitalSignature | KeyUsageFlags.keyEncipherment)),
      extension(id_ce_extKeyUsage, false, new ExtendedKeyUsage([id_kp_serverAuth])),
      extension(id_ce_subjectAltName, false, san),
    ],
  });
  return { cert, key: keyPem };
}

function notAfter(certPem: string): number {
  return new X509Certificate(certPem).validToDate.getTime();
}

/**
 * Är leafen utfärdad av JUST den här CA:n? Namnmatchning räcker inte: en
 * återskapad CA får samma CN, så signaturen kontrolleras mot CA:ns nyckel.
 */
function leafIssuedBy(leafPem: string, caPem: string): boolean {
  return new X509Certificate(leafPem).verify(new X509Certificate(caPem).publicKey);
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
