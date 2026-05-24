/**
 * Integrationstest för WebDAV-serverns atomic save-flöde.
 *
 * Testar två scenarier:
 *   1. Normalt macOS-flöde — MKCOL → PUT → MOVE till riktig plats → DELETE
 *   2. Buggy macOS-flöde  — MKCOL → PUT → MOVE junk-till-junk → DELETE utan
 *      slutlig MOVE. Kräver att `rescue`-logiken i DELETE-handlern plockar upp
 *      innehållet innan junk-mappen slängs.
 *
 * Testar mot en riktig HTTP-server på slumpvald port + riktig Prisma mot dev-DB
 * (vi skapar unika ärenden per test och städar efter oss). Körs med:
 *
 *   npx vitest run scripts/webdav-server.test.ts
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { hash } from "bcryptjs";

// Se till att servern inte startar sin egen listener vid modul-import.
process.env.WEBDAV_SKIP_LISTEN = "1";

// Dynamisk import så WEBDAV_SKIP_LISTEN hinner sättas.
const { server, prisma } = await import("../../tooling/scripts/webdav-server");

let baseUrl: string;
let auth: string;
let matterId: string;
let matterSlug: string;
let docId: string;
const testUserEmail = `webdav-test+${Date.now()}@example.com`;
const testPassword = "test-password-12345";

/** Minsta giltiga PDF-header — nog för att Tika inte ska krascha vid analys. */
function pdfWithMarker(marker: string): Buffer {
  return Buffer.from(`%PDF-1.4\n% ${marker}\n%%EOF\n`);
}

async function webdavRequest(
  method: string,
  path: string,
  opts: { body?: Buffer; headers?: Record<string, string> } = {},
): Promise<{ status: number; text: string }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      ...opts.headers,
    },
    body: opts.body ? new Uint8Array(opts.body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, text };
}

// WebDAV-stacken är borttagen i nuvarande arkitektur (Tier 1-3 via git
// istället för WebDAV). Skipa hela suiten — historisk arkiv kvar tills
// vi tar bort scripts/webdav-server.ts.
const SKIP_WEBDAV = true;

beforeAll(async () => {
  if (SKIP_WEBDAV) return;
  // Starta servern på slumpvald port.
  await new Promise<void>((resolve) => {
    (server as Server).listen(0, "127.0.0.1", () => resolve());
  });
  const addr = (server as Server).address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  // Skapa en unik testanvändare + ärende. Vi behöver matter i DB för att
  // resolvePath ska hitta destinationer.
  const org = await prisma.organization.findFirstOrThrow();
  const passwordHash = await hash(testPassword, 12);
  const user = await prisma.user.create({
    data: {
      email: testUserEmail,
      name: "WebDAV Test User",
      role: "LAWYER",
      passwordHash,
      organizationId: org.id,
    },
  });
  auth = Buffer.from(`${testUserEmail}:${testPassword}`).toString("base64");

  const testMatterNumber = `TEST-${Date.now()}`;
  const matter = await prisma.matter.create({
    data: {
      matterNumber: testMatterNumber,
      title: "WebDAV Integration Test Matter Åäö",
      organizationId: org.id,
    },
  });
  matterId = matter.id;
  // matterSlug matchar scripts/webdav-server.ts' matterSlug()
  matterSlug = `${matter.matterNumber} - ${matter.title.replace(/[\/\\:*?"<>|]/g, "-")}`;

  // Skapa ett initialt dokument direkt via PUT så vi har något att ersätta.
  const initialPath = `/${encodeURIComponent(matterSlug)}/demofil.pdf`;
  const initial = pdfWithMarker("INITIAL");
  const putRes = await webdavRequest("PUT", initialPath, { body: initial });
  expect(putRes.status).toBe(201);

  const doc = await prisma.document.findFirstOrThrow({
    where: { matterId, fileName: "demofil.pdf" },
  });
  docId = doc.id;
  expect(doc.fileSize).toBe(initial.length);
  expect(doc.version).toBe(1);
}, 30_000);

afterAll(async () => {
  if (SKIP_WEBDAV) return;
  // Städa upp: radera test-docs, test-ärende, test-user.
  await prisma.document.deleteMany({ where: { matterId } }).catch(() => {});
  await prisma.matter.delete({ where: { id: matterId } }).catch(() => {});
  await prisma.user.delete({ where: { email: testUserEmail } }).catch(() => {});
  await new Promise<void>((resolve) => (server as Server).close(() => resolve()));
  await prisma.$disconnect();
}, 30_000);

describe.skip("WebDAV atomic save — normalt macOS-flöde", () => {
  it("MKCOL → PUT → MOVE till riktig plats → DELETE sparar filen via MOVE 204", async () => {
    const encodedMatter = encodeURIComponent(matterSlug);
    const realPath = `/${encodedMatter}/demofil.pdf`;
    const sbDir = `/${encodedMatter}/demofil.pdf.sb-aa111111-NORMAL`;
    const sbFile = `${sbDir}/demofil.pdf`;
    const marker = `NORMAL-${Date.now()}`;
    const body = pdfWithMarker(marker);

    expect((await webdavRequest("MKCOL", sbDir)).status).toBe(201);
    expect((await webdavRequest("PUT", sbFile, { body })).status).toBe(204);

    // MOVE till den riktiga platsen — handlern ska upptäcka att destinationen
    // är ett befintligt dokument och skriva över innehållet.
    const moveRes = await webdavRequest("MOVE", sbFile, {
      headers: { Destination: `${baseUrl}${realPath}` },
    });
    expect(moveRes.status).toBe(204);

    // DELETE temp-mappen — inget ska finnas kvar att rädda.
    expect((await webdavRequest("DELETE", sbDir)).status).toBe(204);

    const doc = await prisma.document.findUniqueOrThrow({ where: { id: docId } });
    expect(doc.fileSize).toBe(body.length);
    expect(doc.version).toBeGreaterThanOrEqual(2);
  }, 15_000);
});

describe.skip("WebDAV atomic save — buggy macOS-flöde (MOVE till riktig plats skippas)", () => {
  it("räddar innehållet när DELETE av .sb-dir ska slänga en committerad fil", async () => {
    const encodedMatter = encodeURIComponent(matterSlug);
    const outerSb = `/${encodedMatter}/demofil.pdf.sb-bb222222-BUGGY1`;
    const innerSb = `${outerSb}/demofil.pdf.sb-cc333333-BUGGY2`;
    const innerFile = `${innerSb}/demofil.pdf`;
    const outerFile = `${outerSb}/demofil.pdf`;
    const marker = `RESCUED-${Date.now()}`;
    const body = pdfWithMarker(marker);

    // Hämta versionen innan så vi vet att rescue bumpade den.
    const before = await prisma.document.findUniqueOrThrow({ where: { id: docId } });

    expect((await webdavRequest("MKCOL", outerSb)).status).toBe(201);
    expect((await webdavRequest("MKCOL", innerSb)).status).toBe(201);
    expect((await webdavRequest("PUT", innerFile, { body })).status).toBe(204);

    // MOVE från nested junk till outer junk — båda är junk-paths, så bara
    // omflyttning i in-memory junk-store.
    const move1 = await webdavRequest("MOVE", innerFile, {
      headers: { Destination: `${baseUrl}${outerFile}` },
    });
    expect(move1.status).toBe(201);

    // Städa inner dir.
    expect((await webdavRequest("DELETE", innerSb)).status).toBe(204);

    // ACHTUNG: här hoppar macOS-buggen över det slutliga MOVE till riktig plats.
    // Istället kommer DELETE direkt — detta är vad rescue-logiken ska fånga.
    const deleteOuter = await webdavRequest("DELETE", outerSb);
    expect(deleteOuter.status).toBe(204);

    // Kontrollera att rescue skrev in innehållet till rätt dokument.
    const after = await prisma.document.findUniqueOrThrow({ where: { id: docId } });
    expect(after.fileSize).toBe(body.length);
    expect(after.version).toBeGreaterThan(before.version);
  }, 15_000);

  it("DELETE av icke-MKCOL:ad .sb-path påverkar inte riktiga dokument", async () => {
    // Simulerar en .sb-path som aldrig existerat (macOS-fragment från en
    // tidigare session). DELETE ska returnera 204 men inte röra den riktiga filen.
    const before = await prisma.document.findUniqueOrThrow({ where: { id: docId } });

    const phantomSb = `/${encodeURIComponent(matterSlug)}/demofil.pdf.sb-00000000-GHOSTY`;
    const res = await webdavRequest("DELETE", phantomSb);
    expect(res.status).toBe(204);

    const after = await prisma.document.findUniqueOrThrow({ where: { id: docId } });
    expect(after.version).toBe(before.version);
    expect(after.fileSize).toBe(before.fileSize);
  }, 10_000);

  it("DELETE av .sb-path utan committerat innehåll rör inte riktiga dokument", async () => {
    // MKCOL men ingen PUT — ingen fil att rädda.
    const before = await prisma.document.findUniqueOrThrow({ where: { id: docId } });
    const sb = `/${encodeURIComponent(matterSlug)}/demofil.pdf.sb-dd444444-EMPTY0`;

    expect((await webdavRequest("MKCOL", sb)).status).toBe(201);
    expect((await webdavRequest("DELETE", sb)).status).toBe(204);

    const after = await prisma.document.findUniqueOrThrow({ where: { id: docId } });
    expect(after.version).toBe(before.version);
    expect(after.fileSize).toBe(before.fileSize);
  }, 10_000);
});

describe.skip("WebDAV — basic protocol", () => {
  it("OPTIONS returnerar Allow-headers utan auth", async () => {
    const res = await fetch(`${baseUrl}/`, { method: "OPTIONS" });
    expect(res.status).toBe(200);
  });

  it("kräver auth: utan Authorization → 401", async () => {
    const res = await fetch(`${baseUrl}/`, { method: "PROPFIND" });
    expect(res.status).toBe(401);
  });

  it("avvisar fel lösenord", async () => {
    const wrongAuth = Buffer.from(`${testUserEmail}:wrong-password`).toString("base64");
    const res = await fetch(`${baseUrl}/`, {
      method: "PROPFIND",
      headers: { Authorization: `Basic ${wrongAuth}` },
    });
    expect(res.status).toBe(401);
  });

  it("PROPFIND på roten listar ärenden för användarens org", async () => {
    const res = await webdavRequest("PROPFIND", "/", {
      headers: { Depth: "1" },
    });
    expect(res.status).toBe(207);
    expect(res.text).toContain(matterSlug);
  });

  it("PROPFIND på ärendemappen listar dokument", async () => {
    const res = await webdavRequest("PROPFIND", `/${encodeURIComponent(matterSlug)}/`, {
      headers: { Depth: "1" },
    });
    expect(res.status).toBe(207);
    expect(res.text).toContain("demofil.pdf");
  });

  it("PROPFIND på okänd mapp returnerar 404", async () => {
    const res = await webdavRequest("PROPFIND", "/finns-inte/", {
      headers: { Depth: "1" },
    });
    expect(res.status).toBe(404);
  });

  it("GET hämtar dokumentinnehåll", async () => {
    const path = `/${encodeURIComponent(matterSlug)}/demofil.pdf`;
    const res = await fetch(`${baseUrl}${path}`, {
      method: "GET",
      headers: { Authorization: `Basic ${auth}` },
    });
    expect(res.status).toBe(200);
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it("HEAD returnerar headers utan body", async () => {
    const path = `/${encodeURIComponent(matterSlug)}/demofil.pdf`;
    const res = await fetch(`${baseUrl}${path}`, {
      method: "HEAD",
      headers: { Authorization: `Basic ${auth}` },
    });
    expect(res.status).toBe(200);
  });

  it("GET på okänt dokument returnerar 404 eller 405", async () => {
    const res = await webdavRequest(
      "GET",
      `/${encodeURIComponent(matterSlug)}/finns-inte.pdf`,
    );
    expect([404, 405]).toContain(res.status);
  });

  it("LOCK returnerar 200 med token", async () => {
    const res = await webdavRequest(
      "LOCK",
      `/${encodeURIComponent(matterSlug)}/demofil.pdf`,
    );
    expect([200, 201]).toContain(res.status);
  });

  it("UNLOCK returnerar 204", async () => {
    const res = await webdavRequest(
      "UNLOCK",
      `/${encodeURIComponent(matterSlug)}/demofil.pdf`,
      { headers: { "Lock-Token": "<opaquelocktoken:fake>" } },
    );
    expect([204, 409]).toContain(res.status);
  });

  it("okänt verb returnerar 4xx", async () => {
    const res = await webdavRequest("WACKY", "/");
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("GET med Range-header returnerar 206 Partial Content", async () => {
    const path = `/${encodeURIComponent(matterSlug)}/demofil.pdf`;
    const res = await fetch(`${baseUrl}${path}`, {
      method: "GET",
      headers: { Authorization: `Basic ${auth}`, Range: "bytes=0-9" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toMatch(/^bytes 0-9\//);
  });

  it("GET med suffix-Range bytes=-5 returnerar sista N bytes", async () => {
    const path = `/${encodeURIComponent(matterSlug)}/demofil.pdf`;
    const res = await fetch(`${baseUrl}${path}`, {
      method: "GET",
      headers: { Authorization: `Basic ${auth}`, Range: "bytes=-5" },
    });
    expect(res.status).toBe(206);
  });

  it("GET med ogiltig Range returnerar 416", async () => {
    const path = `/${encodeURIComponent(matterSlug)}/demofil.pdf`;
    const res = await fetch(`${baseUrl}${path}`, {
      method: "GET",
      headers: { Authorization: `Basic ${auth}`, Range: "bytes=99999-999999" },
    });
    expect(res.status).toBe(416);
  });

  it("HEAD med Range returnerar 206 utan body", async () => {
    const path = `/${encodeURIComponent(matterSlug)}/demofil.pdf`;
    const res = await fetch(`${baseUrl}${path}`, {
      method: "HEAD",
      headers: { Authorization: `Basic ${auth}`, Range: "bytes=0-9" },
    });
    expect(res.status).toBe(206);
  });

  it("PROPFIND med fel auth returnerar 401", async () => {
    const res = await fetch(`${baseUrl}/`, {
      method: "PROPFIND",
      headers: { Authorization: "Basic invalid" },
    });
    expect(res.status).toBe(401);
  });

  it("PUT till okänd matter-slug returnerar 4xx", async () => {
    const res = await webdavRequest(
      "PUT",
      "/finns-inte-matter/test.pdf",
      { body: pdfWithMarker("X") },
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("PROPFIND på dokument (depth=0) returnerar 207 med dokument-info", async () => {
    const path = `/${encodeURIComponent(matterSlug)}/demofil.pdf`;
    const res = await webdavRequest("PROPFIND", path, {
      headers: { Depth: "0" },
    });
    expect([207, 200]).toContain(res.status);
  });

  it("MKCOL skapar undermapp i ett ärende", async () => {
    const folderName = `subfolder-${Date.now()}`;
    const path = `/${encodeURIComponent(matterSlug)}/${folderName}`;
    const res = await webdavRequest("MKCOL", path);
    expect(res.status).toBe(201);
    // Cleanup
    await webdavRequest("DELETE", path);
  });

  it("MKCOL i okänt ärende returnerar 4xx", async () => {
    const res = await webdavRequest("MKCOL", "/finns-inte-helt/x");
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("MOVE utan Destination header returnerar 400", async () => {
    const path = `/${encodeURIComponent(matterSlug)}/demofil.pdf`;
    const res = await webdavRequest("MOVE", path);
    expect(res.status).toBe(400);
  });

  it("DELETE på okänd path returnerar 404", async () => {
    const res = await webdavRequest(
      "DELETE",
      `/${encodeURIComponent(matterSlug)}/finns-verkligen-inte.pdf`,
    );
    expect([404, 405]).toContain(res.status);
  });

  it("MOVE byter namn på en fil", async () => {
    // Först skapa en fil
    const src = `/${encodeURIComponent(matterSlug)}/rename-src-${Date.now()}.pdf`;
    await webdavRequest("PUT", src, { body: pdfWithMarker("R") });
    const dst = `/${encodeURIComponent(matterSlug)}/rename-dst-${Date.now()}.pdf`;
    const res = await fetch(`${baseUrl}${src}`, {
      method: "MOVE",
      headers: {
        Authorization: `Basic ${auth}`,
        Destination: `${baseUrl}${dst}`,
      },
    });
    expect([201, 204]).toContain(res.status);
    // Cleanup
    await webdavRequest("DELETE", dst);
  });
});
