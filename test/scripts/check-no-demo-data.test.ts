/**
 * `check-no-demo-data.ts` (#1352) — prod-bygget får inte innehålla demodata.
 *
 * Kör mot ett `out/` med det ett DEMO-bygge lägger dit (seed, användare,
 * datamanifest, PDF:er, förrenderade demo-id-sidor) och mot ett rent skal.
 */
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest-compat";
import {
  findDemoData, isDemoDataPath, isDemoEntityPage, matchesCaddyPath,
} from "../../tooling/scripts/check-no-demo-data";

const MATTER = "0fb22dd8-566b-566e-9dfc-4238f1941b67";
let out = "";

async function file(rel: string, body = "skal"): Promise<void> {
  const p = join(out, rel);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, body);
}

/** Det ett prod-bygge ska ha: skalet, shell-sentinellerna och PWA-manifestet. */
async function shell(): Promise<void> {
  await file("index.html");
  await file("404.html");
  await file("sw.js");
  await file("manifest.json", '{"name":"AVA — Advokat-CRM"}');
  await file("_next/static/chunks/app.js");
  await file("matters/index.html");
  await file("matters/__shell__/index.html");
  await file("matters/__shell__/index.txt");
  await file("users/new/index.html");
  await file("templates/__shell__/edit/index.html");
  await file("documents-help.txt");
}

beforeEach(async () => { out = await mkdtemp(join(tmpdir(), "ava-no-demo-")); });
afterEach(async () => { await rm(out, { recursive: true, force: true }); });

describe("matchesCaddyPath", () => {
  it("prefix, suffix och exakt — som Caddys path-matcher", () => {
    expect(matchesCaddyPath("/.ava/users/a.json", "/.ava/*")).toBe(true);
    expect(matchesCaddyPath("/matters/active/x.json", "*.json")).toBe(true);
    expect(matchesCaddyPath("/demo-seed.json", "/demo-seed.json")).toBe(true);
    expect(matchesCaddyPath("/x/demo-seed.json", "/demo-seed.json")).toBe(false);
    expect(matchesCaddyPath("/documentsx", "/documents/*")).toBe(false);
    expect(matchesCaddyPath("/documents/content/a.pdf", "/documents/content/*")).toBe(true);
  });
});

describe("isDemoDataPath / isDemoEntityPage", () => {
  it("PWA-manifestet passerar, all annan JSON och data-mapparna nekas", () => {
    expect(isDemoDataPath("/manifest.json")).toBe(false);
    expect(isDemoDataPath("/contacts/c1.json")).toBe(true);
    expect(isDemoDataPath("/documents/content/a.pdf")).toBe(true);
    expect(isDemoDataPath("/index.html")).toBe(false);
    expect(isDemoDataPath("/_next/static/chunks/x.json")).toBe(false);
    expect(isDemoDataPath("/documents/index.html")).toBe(false);
  });

  it("förrenderade id-sidor är demo; __shell__ och new är app-sidor", () => {
    expect(isDemoEntityPage(`/matters/${MATTER}/index.html`)).toBe(true);
    expect(isDemoEntityPage(`/templates/${MATTER}/edit/index.html`)).toBe(true);
    expect(isDemoEntityPage("/matters/__shell__/index.html")).toBe(false);
    expect(isDemoEntityPage("/users/new/index.html")).toBe(false);
    expect(isDemoEntityPage("/matters/index.html")).toBe(false);
  });
});

describe("findDemoData", () => {
  it("ett rent prod-skal har ingen demodata", async () => {
    await shell();
    expect(await findDemoData(out)).toEqual([]);
  });

  it("hittar allt ett demo-bygge lägger i out/", async () => {
    await shell();
    await file("demo-seed.json", "{}");
    await file(".ava/users/anna.json", "{}");
    await file(".ava/meta.json", "{}");
    await file("matters/active/m1.json", "{}");
    await file("documents/content/stamning.pdf", "%PDF");
    await file(`matters/${MATTER}/index.html`);
    await file("search/index.txt", '{"email":"anna@ava.demo"}');
    expect(await findDemoData(out)).toEqual([
      "/.ava/meta.json: demodata",
      "/.ava/users/anna.json: demodata",
      "/demo-seed.json: demodata",
      "/documents/content/stamning.pdf: demodata",
      `/matters/${MATTER}/index.html: förrenderad demo-sida`,
      "/matters/active/m1.json: demodata",
      "/search/index.txt: innehåller @ava.demo",
    ]);
  });

  it("ett datamanifest i stället för PWA-manifestet fångas på innehållet", async () => {
    await file("index.html");
    await file("manifest.json", '{"paths":[".ava/users/anna@ava.demo.json"]}');
    expect(await findDemoData(out)).toEqual(["/manifest.json: innehåller @ava.demo"]);
  });
});

describe("CLI", () => {
  const cli = (): { status: number; text: string } => {
    const r = spawnSync(process.execPath, ["tooling/scripts/check-no-demo-data.ts", out], { encoding: "utf8" });
    return { status: r.status ?? -1, text: `${r.stdout}${r.stderr}` };
  };

  it("exit 0 för ett rent skal", async () => {
    await shell();
    const { status, text } = cli();
    expect(status, text).toBe(0);
    expect(text).toContain("ingen demodata");
  });

  it("exit 1 och listar filerna när demodata följt med", async () => {
    await shell();
    await file("demo-seed.json", "{}");
    const { status, text } = cli();
    expect(status).toBe(1);
    expect(text).toContain("/demo-seed.json: demodata");
  });
});
