"use client";

/**
 * Konvertera WebCrypto Ed25519-publika nycklar till OpenSSH:s
 * authorized_keys-format (`ssh-ed25519 AAAA... kommentar`).
 *
 * SSH wire-format för Ed25519 publik nyckel:
 *   uint32be(11) "ssh-ed25519" uint32be(32) <32 bytes pubkey>
 *
 * Hela bytestringen base64-kodas och skrivs efter `ssh-ed25519 `.
 *
 * Fingerprintet beräknas som `SHA256:<base64(sha256(raw-pubkey-bytes))>`
 * vilket matchar `ssh-keygen -lf`.
 */

const SSH_ED25519_TYPE = "ssh-ed25519";

/**
 * Bygg OpenSSH-publika-nyckel-strängen från råa Ed25519-byte:s (32 bytes).
 * Lägger till `comment` (om angivet) som sista fält.
 */
export function buildSshPublicKey(rawPubkey: Uint8Array, comment?: string): string {
  if (rawPubkey.byteLength !== 32) {
    throw new Error(`Ed25519-pubkey ska vara 32 bytes, fick ${rawPubkey.byteLength}`);
  }
  const blob = encodeSshWireFormat(rawPubkey);
  const b64 = base64Encode(blob);
  return comment ? `${SSH_ED25519_TYPE} ${b64} ${comment}` : `${SSH_ED25519_TYPE} ${b64}`;
}

/**
 * Beräkna SSH-fingerprintet (SHA256-format) för en rå Ed25519-pubkey.
 * Returnerar `SHA256:abc…` (samma format som `ssh-keygen -lf`).
 */
export async function sshFingerprint(rawPubkey: Uint8Array): Promise<string> {
  const blob = encodeSshWireFormat(rawPubkey);
  const hash = await crypto.subtle.digest("SHA-256", blob.buffer as ArrayBuffer);
  // Base64 utan padding (samma som ssh-keygen)
  const b64 = base64Encode(new Uint8Array(hash)).replace(/=+$/, "");
  return `SHA256:${b64}`;
}

/**
 * Pack:a SSH-wire-format för en Ed25519-publik nyckel:
 *   uint32be(11) "ssh-ed25519" uint32be(32) <32 bytes>
 */
function encodeSshWireFormat(rawPubkey: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(SSH_ED25519_TYPE);
  const out = new Uint8Array(4 + typeBytes.length + 4 + rawPubkey.length);
  let offset = 0;
  writeUint32Be(out, offset, typeBytes.length); offset += 4;
  out.set(typeBytes, offset); offset += typeBytes.length;
  writeUint32Be(out, offset, rawPubkey.length); offset += 4;
  out.set(rawPubkey, offset);
  return out;
}

function writeUint32Be(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>> 8) & 0xff;
  buf[offset + 3] = value & 0xff;
}

function base64Encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
