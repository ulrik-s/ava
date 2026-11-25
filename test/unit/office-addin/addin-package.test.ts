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
import {
  addinBaseUrl, addinConfigFromEnv, manifestVersion, renderConfigJs, renderManifest,
} from "../../../office-addin/manifest";

const ROOT = join(import.meta.dir, "..", "..", "..", "office-addin");
const TEMPLATE = readFileSync(join(ROOT, "manifests", "outlook-manifest.xml"), "utf8");
const HTML = readFileSync(join(ROOT, "taskpane", "taskpane.html"), "utf8");

/** Produktionens miljö (värdena ur ava-server.env; klient-id och tenant är inte hemliga). */
const PROD_ENV = {
  AVA_DOMAIN: "ava-crm.io",
  AVA_VERSION: "v0.7.20",
  OAUTH2_PROXY_CLIENT_ID: "73542ff5-5080-4f17-b08f-419a734decf7",
  OIDC_ISSUER_URL: "https://login.microsoftonline.com/c503234f-3ed9-44d4-9712-a870c5e4cc85/v2.0",
};
const MANIFEST = renderManifest(TEMPLATE, { base: addinBaseUrl(PROD_ENV), version: manifestVersion(PROD_ENV) });
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
  it("mallen har platshållare och inga hårdkodade värdar", () => {
    expect(TEMPLATE).toContain("{{BASE}}/taskpane.html");
    expect(TEMPLATE).toContain("<Version>{{VERSION}}</Version>");
    expect(TEMPLATE).not.toMatch(/https:\/\/localhost/);
    expect(MANIFEST).not.toContain("{{");
  });

  it("versionen följer release-taggen", () => {
    expect(text("Version")).toBe("0.7.20");
    expect(manifestVersion({ AVA_VERSION: "v0.7.20-3-gabc123" })).toBe("0.7.20");
    expect(manifestVersion({})).toBe("0.0.0");
  });

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

  it("kräver Mailbox 1.3 — convertToRestId finns först där (token kommer från NAA, inte Office)", () => {
    const req = byTag("Set").find((s) => s.getAttribute("Name") === "Mailbox");
    expect(req?.getAttribute("MinVersion")).toBe("1.3");
    expect(byTag("Host").map((h) => h.getAttribute("Name"))).toContain("Mailbox");
  });

  it("begär minsta behörighet (ReadItem); mejlet läses via Graph", () => {
    expect(text("Permissions")).toBe("ReadItem");
  });

  it("alla URL:er är HTTPS; det tillägget laddar ligger på en och samma origin", () => {
    const all = urls();
    expect(all.length).toBeGreaterThan(0);
    for (const u of all) expect(new URL(u).protocol, u).toBe("https:");
    // SupportUrl är bara en länk; task-panen och ikonerna måste serveras från samma ställe.
    const loaded = ["SourceLocation", "IconUrl", "HighResolutionIconUrl"].map((t) => one(t).getAttribute("DefaultValue") ?? "");
    expect(new Set(loaded.map((u) => new URL(u).origin)).size).toBe(1);
  });

  it("serveras från AVA:s domän under /addin/", () => {
    expect(one("SourceLocation").getAttribute("DefaultValue")).toBe("https://ava-crm.io/addin/taskpane.html");
  });

  it("task-panen och ikonerna pekar på filer som bygget levererar", () => {
    const source = one("SourceLocation").getAttribute("DefaultValue") ?? "";
    expect(new URL(source).pathname).toBe("/addin/taskpane.html");
    const assets = new Set(readdirSync(join(ROOT, "assets")));
    for (const tag of ["IconUrl", "HighResolutionIconUrl"]) {
      const path = new URL(one(tag).getAttribute("DefaultValue") ?? "").pathname;
      expect(path.startsWith("/addin/assets/"), `${tag}: ${path}`).toBe(true);
      expect(assets.has(path.slice("/addin/assets/".length)), `${tag}: ${path} saknas i office-addin/assets`).toBe(true);
    }
  });
});

describe("installationens konfiguration (config.js)", () => {
  it("klient-id och tenant ur deployens miljö", () => {
    expect(addinConfigFromEnv(PROD_ENV)).toEqual({
      clientId: "73542ff5-5080-4f17-b08f-419a734decf7", tenantId: "c503234f-3ed9-44d4-9712-a870c5e4cc85",
    });
  });

  it("AVA_ADDIN_CLIENT_ID och AVA_ADDIN_TENANT_ID går före webbinloggningens värden", () => {
    expect(addinConfigFromEnv({ ...PROD_ENV, AVA_ADDIN_CLIENT_ID: " addin ", AVA_ADDIN_TENANT_ID: "t2" }))
      .toEqual({ clientId: "addin", tenantId: "t2" });
  });

  it("utan Entra-uppgifter: ingen konfiguration (panelen säger 'inte konfigurerat')", () => {
    expect(addinConfigFromEnv({ AVA_DOMAIN: "x" })).toBeNull();
    expect(renderConfigJs(null)).toContain("window.AVA_ADDIN = undefined;");
  });

  it("config.js sätter window.AVA_ADDIN", () => {
    const js = renderConfigJs(addinConfigFromEnv(PROD_ENV));
    const win: { AVA_ADDIN?: unknown } = {};
    new Function("window", js)(win);
    expect(win.AVA_ADDIN).toEqual(addinConfigFromEnv(PROD_ENV));
  });

  it("lokalt utan domän: https://localhost:3443 (office-addin-serve)", () => {
    expect(addinBaseUrl({})).toBe("https://localhost:3443");
    expect(addinBaseUrl({ AVA_ADDIN_BASE_URL: "https://x.test/addin/" })).toBe("https://x.test/addin");
  });
});

describe("task-panens HTML", () => {
  it("laddar Office.js från Microsofts CDN, sedan config.js, sist bundlen", () => {
    const office = HTML.indexOf('src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"');
    const config = HTML.indexOf('src="./config.js"');
    const bundle = HTML.indexOf('src="./taskpane.js"');
    expect(office).toBeGreaterThan(-1);
    expect(config).toBeGreaterThan(office);
    expect(bundle).toBeGreaterThan(config);
  });

  it("frågar inte efter server eller PAT (inloggningen sker via Outlook)", () => {
    expect(HTML).not.toMatch(/id="(server|pat)"/);
  });

  it("har alla element som controllern slår upp", () => {
    const page = new DOMParser().parseFromString(HTML, "text/html");
    expect(page.getElementById("app")).not.toBeNull();
    const tpl = page.getElementById("form-tpl") as HTMLTemplateElement | null;
    expect(tpl).not.toBeNull();
    const form = tpl?.content ?? page.createDocumentFragment();
    for (const id of ["who", "q", "results", "minutes", "description", "save", "status"]) {
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
