/**
 * Outlook-tilläggets paket (lager 1 i CI): manifestet, task-panens HTML och
 * bundlen. Ett trasigt manifest eller en mall som tappat ett id upptäcks
 * annars först när en jurist öppnar Outlook.
 *
 * Office kan inte köras i CI. Det som går att kontrollera utan Outlook
 * kontrolleras här; resten täcks av E2E:n med fake-Office (test/e2e/addin/).
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest-compat";

const ROOT = join(import.meta.dir, "..", "..", "..", "office-addin");
const MANIFEST = readFileSync(join(ROOT, "manifests", "outlook-manifest.xml"), "utf8");
const HTML = readFileSync(join(ROOT, "taskpane", "taskpane.html"), "utf8");

const doc = new DOMParser().parseFromString(MANIFEST, "application/xml");
const byTag = (tag: string): Element[] => [...doc.getElementsByTagName(tag)];
const one = (tag: string): Element => {
  const els = byTag(tag);
  expect(els, `<${tag}> ska finnas exakt en gång`).toHaveLength(1);
  return els[0] as Element;
};
const text = (tag: string): string => one(tag).textContent.trim();
/** Alla URL:er manifestet pekar på (DefaultValue-attribut och SupportUrl m.fl.). */
const urls = (): string[] =>
  [...doc.getElementsByTagName("*")]
    .map((el) => el.getAttribute("DefaultValue") ?? "")
    .filter((v) => /^[a-z]+:\/\//i.test(v));

describe("Outlook-manifestet", () => {
  it("är välformad XML", () => {
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(doc.documentElement.tagName).toBe("OfficeApp");
  });

  it("är ett mejltillägg med giltigt id och version", () => {
    expect(doc.documentElement.getAttribute("xsi:type")).toBe("MailApp");
    expect(text("Id")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(text("Version")).toMatch(/^\d+\.\d+\.\d+(\.\d+)?$/);
    expect(text("ProviderName")).not.toBe("");
    expect(one("DisplayName").getAttribute("DefaultValue")).not.toBe("");
  });

  it("kräver Mailbox 1.5 — restUrl och getCallbackTokenAsync({isRest}) finns först där", () => {
    const req = byTag("Set").find((s) => s.getAttribute("Name") === "Mailbox");
    expect(req?.getAttribute("MinVersion")).toBe("1.5");
    expect(byTag("Host").map((h) => h.getAttribute("Name"))).toContain("Mailbox");
  });

  it("har behörighet att läsa mejlet (REST-token kräver minst ReadItem)", () => {
    expect(["ReadItem", "ReadWriteItem", "ReadWriteMailbox"]).toContain(text("Permissions"));
  });

  it("alla URL:er är HTTPS; det tillägget laddar ligger på en och samma origin", () => {
    const all = urls();
    expect(all.length).toBeGreaterThan(0);
    for (const u of all) expect(new URL(u).protocol, u).toBe("https:");
    // SupportUrl är bara en länk; task-panen och ikonerna måste serveras från samma ställe.
    const loaded = ["SourceLocation", "IconUrl", "HighResolutionIconUrl"].map((t) => one(t).getAttribute("DefaultValue") ?? "");
    expect(new Set(loaded.map((u) => new URL(u).origin)).size).toBe(1);
  });

  it("task-panen och ikonerna pekar på filer som bygget levererar", () => {
    const source = one("SourceLocation").getAttribute("DefaultValue") ?? "";
    expect(new URL(source).pathname).toBe("/taskpane.html");
    const assets = new Set(readdirSync(join(ROOT, "assets")));
    for (const tag of ["IconUrl", "HighResolutionIconUrl"]) {
      const path = new URL(one(tag).getAttribute("DefaultValue") ?? "").pathname;
      expect(path.startsWith("/assets/"), `${tag}: ${path}`).toBe(true);
      expect(assets.has(path.slice("/assets/".length)), `${tag}: ${path} saknas i office-addin/assets`).toBe(true);
    }
  });
});

describe("task-panens HTML", () => {
  it("laddar Office.js från Microsofts CDN före bundlen", () => {
    const office = HTML.indexOf('src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"');
    const bundle = HTML.indexOf('src="./taskpane.js"');
    expect(office).toBeGreaterThan(-1);
    expect(bundle).toBeGreaterThan(office);
  });

  it("har alla element som controllern slår upp", () => {
    const page = new DOMParser().parseFromString(HTML, "text/html");
    expect(page.getElementById("app")).not.toBeNull();
    const tpl = page.getElementById("form-tpl") as HTMLTemplateElement | null;
    expect(tpl).not.toBeNull();
    const form = tpl?.content ?? page.createDocumentFragment();
    for (const id of ["server", "pat", "q", "results", "minutes", "save", "status"]) {
      expect(form.querySelector(`#${id}`), `#${id} saknas i #form-tpl`).not.toBeNull();
    }
  });
});

describe("bundlen", () => {
  const out = mkdtempSync(join(tmpdir(), "ava-addin-"));
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it("bygger för webbläsaren med samma inställningar som office-addin/build.ts", async () => {
    const result = await Bun.build({
      entrypoints: [join(ROOT, "taskpane", "taskpane.ts")],
      outdir: out,
      target: "browser",
      minify: true,
      naming: "[dir]/taskpane.js",
    });
    expect(result.logs.filter((l) => l.level === "error")).toEqual([]);
    expect(result.success).toBe(true);
    const js = join(out, "taskpane.js");
    expect(existsSync(js)).toBe(true);
    const code = readFileSync(js, "utf8");
    // Inget Node-only får läcka in i webbläsarbundlen (den körs i Outlooks webview).
    expect(code).not.toMatch(/\brequire\(["']node:/);
    expect(code).toContain("/api/trpc");
  }, 30_000);
});
