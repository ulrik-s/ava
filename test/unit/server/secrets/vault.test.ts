import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest-compat";
import { EncryptedFileVault, createVaultFromEnv, nodeVaultFs, type VaultFs } from "@/lib/server/secrets/vault";

const key = Buffer.alloc(32, 3);
const otherKey = Buffer.alloc(32, 4);
const PATH = "/data/secrets.enc";

/** In-memory VaultFs som speglar "disk". */
function memFs(): VaultFs & { disk: Map<string, string> } {
  const disk = new Map<string, string>();
  return {
    disk,
    async read(p: string) {
      return disk.get(p) ?? null;
    },
    async write(p: string, d: string) {
      disk.set(p, d);
    },
  };
}

describe("EncryptedFileVault", () => {
  it("set/get", async () => {
    const v = new EncryptedFileVault(PATH, key, memFs());
    await v.set("fortnox.client_secret", "s3cr3t");
    expect(await v.get("fortnox.client_secret")).toBe("s3cr3t");
  });

  it("saknad nyckel → null", async () => {
    const v = new EncryptedFileVault(PATH, key, memFs());
    expect(await v.get("nope")).toBeNull();
  });

  it("delete tar bort", async () => {
    const v = new EncryptedFileVault(PATH, key, memFs());
    await v.set("a", "1");
    await v.delete("a");
    expect(await v.get("a")).toBeNull();
  });

  it("lagrar krypterat — varken nyckel eller värde i klartext på disk", async () => {
    const fs = memFs();
    const v = new EncryptedFileVault(PATH, key, fs);
    await v.set("token", "super-secret-xyz");
    const onDisk = fs.disk.get(PATH)!;
    expect(onDisk).not.toContain("super-secret-xyz");
    expect(onDisk).not.toContain("token");
  });

  it("persisterar — ny instans (samma fs + nyckel) ser datan", async () => {
    const fs = memFs();
    await new EncryptedFileVault(PATH, key, fs).set("k", "v");
    const reopened = new EncryptedFileVault(PATH, key, fs);
    expect(await reopened.get("k")).toBe("v");
  });

  it("fel master-nyckel kan inte läsa valvet", async () => {
    const fs = memFs();
    await new EncryptedFileVault(PATH, key, fs).set("k", "v");
    const wrong = new EncryptedFileVault(PATH, otherKey, fs);
    await expect(wrong.get("k")).rejects.toThrow();
  });
});

describe("createVaultFromEnv", () => {
  const validKey = Buffer.alloc(32, 1).toString("base64");

  it("kräver nyckel + filväg", () => {
    expect(() => createVaultFromEnv({})).toThrow(/AVA_SECRETS_KEY/);
    expect(() => createVaultFromEnv({ AVA_SECRETS_KEY: validKey })).toThrow(/AVA_SECRETS_FILE/);
  });

  it("bygger ett valv när båda finns", () => {
    const v = createVaultFromEnv({ AVA_SECRETS_KEY: validKey, AVA_SECRETS_FILE: "/srv/secrets.enc" });
    expect(typeof v.get).toBe("function");
  });
});

describe("nodeVaultFs (riktig disk)", () => {
  it("saknad fil → null; skriver krypterat + läser tillbaka", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ava-vault-"));
    try {
      const fs = nodeVaultFs();
      expect(await fs.read(join(dir, "missing.enc"))).toBeNull();

      const file = join(dir, "secrets.enc");
      const v = new EncryptedFileVault(file, key, fs);
      await v.set("token", "hemlis-på-disk");
      expect(await v.get("token")).toBe("hemlis-på-disk");

      const raw = await readFile(file, "utf8");
      expect(raw).not.toContain("hemlis-på-disk"); // krypterat på riktig disk
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
