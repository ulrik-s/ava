/**
 * Tester för SSH-format-konvertering. Vi använder kända test-vectors:
 * Ed25519-pubkey:s ssh-format ska matcha det ssh-keygen producerar.
 */

import { describe, it, expect } from "vitest";
import { buildSshPublicKey, sshFingerprint } from "@/client/lib/keys/ssh-format";

// Test-vector: 32 noll-bytes → välbestämd SSH-string
const ZERO_PUBKEY = new Uint8Array(32);
// Sett från ssh-keygen för all-zero pubkey:
const ZERO_SSH = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("buildSshPublicKey", () => {
  it("32 noll-bytes ger känd ssh-string", () => {
    expect(buildSshPublicKey(ZERO_PUBKEY)).toBe(ZERO_SSH);
  });

  it("inkluderar comment om angiven", () => {
    const s = buildSshPublicKey(ZERO_PUBKEY, "anna@laptop");
    expect(s.endsWith(" anna@laptop")).toBe(true);
    expect(s.startsWith("ssh-ed25519 ")).toBe(true);
  });

  it("kastar om pubkey har fel längd", () => {
    expect(() => buildSshPublicKey(new Uint8Array(16))).toThrow(/32 bytes/);
    expect(() => buildSshPublicKey(new Uint8Array(64))).toThrow(/32 bytes/);
  });

  it("base64-blob:n är 68 chars (50 bytes wire format → 68 base64)", () => {
    const s = buildSshPublicKey(ZERO_PUBKEY);
    const b64 = s.split(" ")[1];
    expect(b64.length).toBe(68);
  });
});

describe("sshFingerprint", () => {
  it("returnerar SHA256:-prefix", async () => {
    const fp = await sshFingerprint(ZERO_PUBKEY);
    expect(fp.startsWith("SHA256:")).toBe(true);
  });

  it("fingerprint är 7 ('SHA256:') + 43 chars (base64 utan padding av 32 bytes)", async () => {
    const fp = await sshFingerprint(ZERO_PUBKEY);
    expect(fp.length).toBe(50);
  });

  it("samma pubkey → samma fingerprint", async () => {
    const a = await sshFingerprint(ZERO_PUBKEY);
    const b = await sshFingerprint(ZERO_PUBKEY);
    expect(a).toBe(b);
  });

  it("olika pubkey → olika fingerprint", async () => {
    const other = new Uint8Array(32).fill(1);
    const a = await sshFingerprint(ZERO_PUBKEY);
    const b = await sshFingerprint(other);
    expect(a).not.toBe(b);
  });
});
