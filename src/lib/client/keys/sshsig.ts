"use client";

/**
 * Implementation av OpenSSH:s SSHSIG-format (PROTOCOL.sshsig), använt
 * för att signera git-commits med SSH-nycklar (`git -c gpg.format=ssh`).
 *
 * Wire-format för signaturen (efter base64-radbrytning):
 *
 *   MAGIC          6 bytes "SSHSIG"
 *   uint32be       version = 0x00000001
 *   string         publickey (SSH wire format)
 *   string         namespace ("git" för git commits)
 *   string         reserved (tom)
 *   string         hash_algorithm ("sha512")
 *   string         signature (SSH signature blob)
 *
 * Signaturen beräknas över ett strukturerat blob:
 *
 *   MAGIC          6 bytes "SSHSIG"
 *   string         namespace
 *   string         reserved
 *   string         hash_algorithm
 *   string         H(message)   ← SHA-512 av meddelandet
 *
 * Slutligen är hela blobben armored:
 *
 *   -----BEGIN SSH SIGNATURE-----
 *   <base64 av wire-format med rad 76 chars>
 *   -----END SSH SIGNATURE-----
 *
 * För git-signering används namespace="git" och hash_algorithm="sha512".
 */

const MAGIC = new TextEncoder().encode("SSHSIG");
const SSHSIG_VERSION = 1;
const SSH_ED25519 = "ssh-ed25519";
const NAMESPACE_GIT = "git";
const HASH_ALGO = "sha512";

export interface SshsigArgs {
  /** Råa 32-byte:s pubkey för Ed25519. */
  publicKey: Uint8Array;
  /** Funktion som signerar en buffert med privata nyckeln. */
  sign: (data: Uint8Array) => Promise<Uint8Array>;
  /** Meddelandet som ska signeras (typiskt commit-objekt-bytes). */
  message: Uint8Array;
}

/**
 * Beräkna SSHSIG-signaturen och returnera den armored-formade strängen.
 */
export async function sshsigSign(args: SshsigArgs): Promise<string> {
  // 1. Hasha meddelandet med SHA-512
  const hash = await crypto.subtle.digest("SHA-512", args.message.buffer as ArrayBuffer);

  // 2. Bygg signed-data-blobben
  const signedData = concat([
    MAGIC,
    sshString(NAMESPACE_GIT),
    sshString(""),                 // reserved
    sshString(HASH_ALGO),
    sshStringBytes(new Uint8Array(hash)),
  ]);

  // 3. Signera signed-data med privata nyckeln
  const rawSig = await args.sign(signedData);
  if (rawSig.byteLength !== 64) {
    throw new Error(`Ed25519-signatur ska vara 64 bytes, fick ${rawSig.byteLength}`);
  }

  // 4. Bygg ssh-signaturblob: string(type) + string(sig)
  const sigBlob = concat([
    sshString(SSH_ED25519),
    sshStringBytes(rawSig),
  ]);

  // 5. Bygg ssh-pubkey-blob: string(type) + string(rawKey)
  const pubkeyBlob = concat([
    sshString(SSH_ED25519),
    sshStringBytes(args.publicKey),
  ]);

  // 6. Sammanställ wire-format
  const wire = concat([
    MAGIC,
    uint32be(SSHSIG_VERSION),
    sshStringBytes(pubkeyBlob),
    sshString(NAMESPACE_GIT),
    sshString(""),
    sshString(HASH_ALGO),
    sshStringBytes(sigBlob),
  ]);

  // 7. Armor:a (PEM-likt format med 76-char rader)
  return armor(wire);
}

// ─── Hjälpfunktioner ─────────────────────────────────────────────────

function sshString(s: string): Uint8Array {
  const bytes = new TextEncoder().encode(s);
  return sshStringBytes(bytes);
}

function sshStringBytes(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + bytes.length);
  writeUint32Be(out, 0, bytes.length);
  out.set(bytes, 4);
  return out;
}

function uint32be(n: number): Uint8Array {
  const out = new Uint8Array(4);
  writeUint32Be(out, 0, n);
  return out;
}

function writeUint32Be(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>> 8) & 0xff;
  buf[offset + 3] = value & 0xff;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.byteLength; }
  return out;
}

function armor(wire: Uint8Array): string {
  const b64 = base64Encode(wire);
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 70) lines.push(b64.slice(i, i + 70));
  return [
    "-----BEGIN SSH SIGNATURE-----",
    ...lines,
    "-----END SSH SIGNATURE-----",
  ].join("\n");
}

function base64Encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}
