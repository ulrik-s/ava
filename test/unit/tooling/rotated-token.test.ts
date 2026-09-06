import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest-compat";
import { InMemoryGraphTokenStore } from "@/lib/server/integrations/msgraph/token-store";
import { emitRotatedToken } from "../../../tooling/scripts/rotated-token";

/**
 * Write-back:en (#1073) är det som gör obevakad drift möjlig. Går den sönder
 * tyst räcker refresh-token:en till EN körning, och nästa dör i auth långt från
 * orsaken. Därför testas den — inte för att koden är svår, utan för att felet
 * är dyrt och osynligt.
 */
const tokens = (rt: string) => ({ accessToken: "at", refreshToken: rt, accessTokenExpiresAt: 1_000 });

let dir: string;
let out: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ava-rot-"));
  out = join(dir, "github_output");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("emitRotatedToken", () => {
  it("skriver refresh_token i GITHUB_OUTPUT-format", async () => {
    const store = new InMemoryGraphTokenStore(tokens("rt-ny"));
    await emitRotatedToken(store, out);
    expect(readFileSync(out, "utf8")).toBe("refresh_token=rt-ny\n");
  });

  /**
   * Step-outputs maskeras INTE automatiskt av GitHub. Utan `::add-mask::` kan
   * ett senare steg som ekar sin env läcka token:en i klartext i loggen.
   */
  it("maskerar token:en innan den skrivs", async () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (m: unknown) => void lines.push(String(m));
    try {
      await emitRotatedToken(new InMemoryGraphTokenStore(tokens("hemlig")), out);
    } finally {
      console.log = original;
    }
    expect(lines[0]).toBe("::add-mask::hemlig");
  });

  // Lokala körningar har ingen $GITHUB_OUTPUT och ska inte behöva bry sig.
  it("är en no-op utan GITHUB_OUTPUT", async () => {
    await emitRotatedToken(new InMemoryGraphTokenStore(tokens("rt")), undefined);
    expect(existsSync(out)).toBe(false);
  });

  // Tomt store = ingen refresh hann ske. Att skriva en tom rad hade fått
  // write-back-steget att köra och skriva över secreten med ingenting.
  it("skriver inget när storen är tom", async () => {
    await emitRotatedToken(new InMemoryGraphTokenStore(), out);
    expect(existsSync(out)).toBe(false);
  });

  it("lägger till, skriver inte över befintlig output", async () => {
    await emitRotatedToken(new InMemoryGraphTokenStore(tokens("a")), out);
    await emitRotatedToken(new InMemoryGraphTokenStore(tokens("b")), out);
    expect(readFileSync(out, "utf8")).toBe("refresh_token=a\nrefresh_token=b\n");
  });
});
