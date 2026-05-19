/**
 * `build-demo-repo` — bygger en lokal mapp redo att pushas som demo-repo.
 *
 * Användning:
 *     yarn tsx scripts/build-demo-repo.ts --dir ./demo-repo
 *
 * Innehåll efter detta script körs:
 *   matters/active/<id>.json
 *   contacts/<id>.json
 *   matter-contacts/<id>.json   (länkar matters ↔ contacts)
 *   documents/<id>.json
 *   time-entries/<id>.json
 *   expenses/<id>.json
 *   invoices/<id>.json
 *   .ava/users/<email>.json
 *
 * Alla namn/personnummer är fiktiva.
 */

import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";

const ORG_ID = "demo-firma-ab";

function date(iso: string): string { return new Date(iso).toISOString(); }

function buildDemoData(): Array<{ path: string; data: unknown }> {
  const all: Array<{ path: string; data: unknown }> = [];

  // ─── Users ───────────────────────────────────────────────────
  all.push(
    { path: ".ava/users/anna@demo-firma.se.json", data: { id: "u-anna", email: "anna@demo-firma.se", name: "Anna Advokat", role: "LAWYER", sshPublicKeys: [], hourlyRate: 2800, organizationId: ORG_ID } },
    { path: ".ava/users/bjorn@demo-firma.se.json", data: { id: "u-bjorn", email: "bjorn@demo-firma.se", name: "Björn Biträde", role: "ASSISTANT", sshPublicKeys: [], hourlyRate: 1800, organizationId: ORG_ID } },
  );

  // ─── Contacts ────────────────────────────────────────────────
  all.push(
    { path: "contacts/c-andersson.json", data: { id: "c-andersson", name: "Anna Andersson", contactType: "PERSON", personalNumber: "19851012-1234", email: "anna.andersson@example.se", phone: "070-1234567", organizationId: ORG_ID } },
    { path: "contacts/c-persson.json", data: { id: "c-persson", name: "Björn Persson", contactType: "PERSON", personalNumber: "19831102-5678", email: "bjorn.persson@example.se", phone: "073-7654321", organizationId: ORG_ID } },
    { path: "contacts/c-brf-vinkeln.json", data: { id: "c-brf-vinkeln", name: "BRF Vinkeln", contactType: "ORGANIZATION", orgNumber: "716123-4567", email: "styrelsen@vinkeln.se", phone: "08-123456", organizationId: ORG_ID } },
    { path: "contacts/c-erikssons.json", data: { id: "c-erikssons", name: "Familjen Eriksson", contactType: "ORGANIZATION", email: "familjen@eriksson.example.se", organizationId: ORG_ID } },
    { path: "contacts/c-eriksson-arvinge.json", data: { id: "c-eriksson-arvinge", name: "Klas Eriksson", contactType: "PERSON", personalNumber: "19601215-7890", organizationId: ORG_ID } },
    { path: "contacts/c-tingsratten.json", data: { id: "c-tingsratten", name: "Stockholms tingsrätt", contactType: "COURT", orgNumber: "202100-2742", email: "stockholms.tingsratt@dom.se", organizationId: ORG_ID } },
    { path: "contacts/c-motpart-advokat.json", data: { id: "c-motpart-advokat", name: "Carl Carlsson", contactType: "LAW_FIRM", email: "cc@motpartbyran.se", organizationId: ORG_ID } },
  );

  // ─── Matters ─────────────────────────────────────────────────
  all.push(
    { path: "matters/active/m-vardnad.json", data: { id: "m-vardnad", matterNumber: "2026-0001", title: "Vårdnadstvist Andersson / Persson", status: "ACTIVE", matterType: "Familjerätt", description: "Vårdnadsmål rörande gemensam dotter (4 år). Klient yrkar ensam vårdnad pga samarbetssvårigheter.", organizationId: ORG_ID, notes: "Möte med klient den 14 maj. Genomgång av handlingar och första kontakt med motpart inplanerat.", createdAt: date("2026-02-15") } },
    { path: "matters/active/m-bostadsratt.json", data: { id: "m-bostadsratt", matterNumber: "2026-0002", title: "Bostadsrätt – tvist med BRF Vinkeln", status: "ACTIVE", matterType: "Fastighetsrätt", description: "BRF har avslagit klientens anspråk på ersättning för vattenskada. Föreningens ansvar enligt stadgar oklart.", organizationId: ORG_ID, notes: "Klient har fått överklagat avslag på reparationsanspråk. Granskar stadgar och brf-stämmoprotokoll.", createdAt: date("2026-03-08") } },
    { path: "matters/active/m-arvskifte.json", data: { id: "m-arvskifte", matterNumber: "2026-0003", title: "Arvskifte efter Eriksson", status: "CLOSED", matterType: "Familjerätt", description: "Bouppteckning och arvskifte efter Karl-Erik Eriksson, avliden 2025-11-04.", organizationId: ORG_ID, notes: "Bouppteckning klar. Arvskifte registrerat hos Skatteverket.", createdAt: date("2025-12-01") } },
  );

  // ─── MatterContacts (länkar) ────────────────────────────────
  all.push(
    { path: "matter-contacts/mc-vardnad-klient.json", data: { id: "mc-vardnad-klient", matterId: "m-vardnad", contactId: "c-andersson", role: "KLIENT", organizationId: ORG_ID, createdAt: date("2026-02-15") } },
    { path: "matter-contacts/mc-vardnad-motpart.json", data: { id: "mc-vardnad-motpart", matterId: "m-vardnad", contactId: "c-persson", role: "MOTPART", organizationId: ORG_ID, createdAt: date("2026-02-15") } },
    { path: "matter-contacts/mc-vardnad-motpartsombud.json", data: { id: "mc-vardnad-motpartsombud", matterId: "m-vardnad", contactId: "c-motpart-advokat", role: "MOTPARTSOMBUD", organizationId: ORG_ID, createdAt: date("2026-02-18") } },
    { path: "matter-contacts/mc-vardnad-domstol.json", data: { id: "mc-vardnad-domstol", matterId: "m-vardnad", contactId: "c-tingsratten", role: "DOMSTOL", organizationId: ORG_ID, createdAt: date("2026-03-01") } },
    { path: "matter-contacts/mc-bostadsratt-klient.json", data: { id: "mc-bostadsratt-klient", matterId: "m-bostadsratt", contactId: "c-persson", role: "KLIENT", organizationId: ORG_ID, createdAt: date("2026-03-08") } },
    { path: "matter-contacts/mc-bostadsratt-motpart.json", data: { id: "mc-bostadsratt-motpart", matterId: "m-bostadsratt", contactId: "c-brf-vinkeln", role: "MOTPART", organizationId: ORG_ID, createdAt: date("2026-03-08") } },
    { path: "matter-contacts/mc-arvskifte-klient.json", data: { id: "mc-arvskifte-klient", matterId: "m-arvskifte", contactId: "c-erikssons", role: "KLIENT", organizationId: ORG_ID, createdAt: date("2025-12-01") } },
    { path: "matter-contacts/mc-arvskifte-arvinge.json", data: { id: "mc-arvskifte-arvinge", matterId: "m-arvskifte", contactId: "c-eriksson-arvinge", role: "OVRIG", organizationId: ORG_ID, createdAt: date("2025-12-05") } },
  );

  // ─── Documents ───────────────────────────────────────────────
  all.push(
    { path: "documents/d-vardnad-stamning.json", data: { id: "d-vardnad-stamning", matterId: "m-vardnad", fileName: "Stämningsansökan vårdnad.pdf", mimeType: "application/pdf", sizeBytes: 184_320, storagePath: "demo/d-vardnad-stamning.pdf", documentType: "Stämningsansökan", summary: "Yrkanden: ensam vårdnad samt umgängesrätt. Grunder: samarbetssvårigheter och bristande omsorg.", uploadedAt: date("2026-02-20"), uploadedById: "u-anna", organizationId: ORG_ID, analysisStatus: "COMPLETED" } },
    { path: "documents/d-vardnad-svar.json", data: { id: "d-vardnad-svar", matterId: "m-vardnad", fileName: "Svaromål motpart.pdf", mimeType: "application/pdf", sizeBytes: 142_336, storagePath: "demo/d-vardnad-svar.pdf", documentType: "Svaromål", summary: "Motpart bestrider yrkandena och vill ha fortsatt gemensam vårdnad.", uploadedAt: date("2026-03-15"), uploadedById: "u-anna", organizationId: ORG_ID, analysisStatus: "COMPLETED" } },
    { path: "documents/d-vardnad-bevis.json", data: { id: "d-vardnad-bevis", matterId: "m-vardnad", fileName: "Bevisförteckning.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sizeBytes: 28_672, storagePath: "demo/d-vardnad-bevis.docx", documentType: "Bevisförteckning", uploadedAt: date("2026-04-02"), uploadedById: "u-bjorn", organizationId: ORG_ID, analysisStatus: "PENDING" } },
    { path: "documents/d-brf-stadgar.json", data: { id: "d-brf-stadgar", matterId: "m-bostadsratt", fileName: "BRF Vinkeln stadgar.pdf", mimeType: "application/pdf", sizeBytes: 96_768, storagePath: "demo/d-brf-stadgar.pdf", documentType: "Stadgar", summary: "Stadgar antagna 2018. §32 reglerar ansvar för vattenskador.", uploadedAt: date("2026-03-10"), uploadedById: "u-anna", organizationId: ORG_ID, analysisStatus: "COMPLETED" } },
    { path: "documents/d-brf-avslag.json", data: { id: "d-brf-avslag", matterId: "m-bostadsratt", fileName: "Avslag från styrelsen.pdf", mimeType: "application/pdf", sizeBytes: 51_200, storagePath: "demo/d-brf-avslag.pdf", documentType: "Brev", uploadedAt: date("2026-03-09"), uploadedById: "u-anna", organizationId: ORG_ID, analysisStatus: "COMPLETED" } },
    { path: "documents/d-arvskifte-bouppt.json", data: { id: "d-arvskifte-bouppt", matterId: "m-arvskifte", fileName: "Bouppteckning Eriksson.pdf", mimeType: "application/pdf", sizeBytes: 245_760, storagePath: "demo/d-arvskifte-bouppt.pdf", documentType: "Bouppteckning", summary: "Tillgångar 2 450 000 kr, skulder 380 000 kr. Tre arvingar.", uploadedAt: date("2025-12-15"), uploadedById: "u-anna", organizationId: ORG_ID, analysisStatus: "COMPLETED" } },
    { path: "documents/d-arvskifte-skifte.json", data: { id: "d-arvskifte-skifte", matterId: "m-arvskifte", fileName: "Arvskifteshandling.pdf", mimeType: "application/pdf", sizeBytes: 87_040, storagePath: "demo/d-arvskifte-skifte.pdf", documentType: "Arvskifteshandling", uploadedAt: date("2026-01-22"), uploadedById: "u-anna", organizationId: ORG_ID, analysisStatus: "COMPLETED" } },
  );

  // ─── Time entries ────────────────────────────────────────────
  const teVardnad = [
    { date: "2026-02-15", min: 60, desc: "Inledande klientmöte, genomgång av sakomständigheter.", user: "u-anna" },
    { date: "2026-02-18", min: 90, desc: "Granskning av handlingar, möte med motpartsombud.", user: "u-anna" },
    { date: "2026-02-20", min: 180, desc: "Författande av stämningsansökan.", user: "u-anna" },
    { date: "2026-03-05", min: 45, desc: "Telefonmöte med klient kring umgängesrätt.", user: "u-anna" },
    { date: "2026-03-15", min: 75, desc: "Genomgång av svaromål, samråd med klient.", user: "u-anna" },
    { date: "2026-04-02", min: 120, desc: "Bevisförteckning, sortering av kommunikation.", user: "u-bjorn" },
  ];
  const teBrf = [
    { date: "2026-03-08", min: 45, desc: "Inledande genomgång av ärendet.", user: "u-anna" },
    { date: "2026-03-10", min: 90, desc: "Granskning av stadgar och stämmoprotokoll.", user: "u-anna" },
    { date: "2026-03-12", min: 60, desc: "Brev till BRF med kompletterande argumentation.", user: "u-anna" },
  ];
  const teArv = [
    { date: "2025-12-05", min: 120, desc: "Klientmöte med arvingar.", user: "u-anna" },
    { date: "2025-12-15", min: 240, desc: "Färdigställande av bouppteckning.", user: "u-anna" },
    { date: "2026-01-20", min: 90, desc: "Möte med Skatteverket-handläggare.", user: "u-anna" },
    { date: "2026-01-22", min: 180, desc: "Arvskifteshandling och uppdelning.", user: "u-anna" },
  ];
  let teId = 1;
  for (const [matterId, entries] of [["m-vardnad", teVardnad], ["m-bostadsratt", teBrf], ["m-arvskifte", teArv]] as const) {
    for (const e of entries) {
      const id = `t-${matterId.replace("m-", "")}-${teId++}`;
      all.push({ path: `time-entries/${id}.json`, data: { id, matterId, userId: e.user, date: date(e.date), minutes: e.min, description: e.desc, billable: true, hourlyRate: e.user === "u-anna" ? 2800 : 1800, organizationId: ORG_ID } });
    }
  }

  // ─── Expenses ────────────────────────────────────────────────
  all.push(
    { path: "expenses/e-vardnad-anstmavg.json", data: { id: "e-vardnad-anstmavg", matterId: "m-vardnad", userId: "u-anna", date: date("2026-02-20"), amount: 90000, description: "Ansökningsavgift tingsrätten", billable: true, organizationId: ORG_ID } },
    { path: "expenses/e-vardnad-kopior.json", data: { id: "e-vardnad-kopior", matterId: "m-vardnad", userId: "u-bjorn", date: date("2026-04-02"), amount: 4500, description: "Kopior och postning av handlingar", billable: true, organizationId: ORG_ID } },
    { path: "expenses/e-arvskifte-skv.json", data: { id: "e-arvskifte-skv", matterId: "m-arvskifte", userId: "u-anna", date: date("2026-01-22"), amount: 25000, description: "Registreringsavgift Skatteverket", billable: true, organizationId: ORG_ID } },
  );

  // ─── Invoices ────────────────────────────────────────────────
  all.push(
    { path: "invoices/i-arvskifte-final.json", data: { id: "i-arvskifte-final", matterId: "m-arvskifte", invoiceNumber: "2026-001", type: "FINAL", status: "PAID", amountExclVat: 18_900_00, vat: 4_725_00, amountInclVat: 23_625_00, issuedAt: date("2026-01-25"), dueAt: date("2026-02-25"), paidAt: date("2026-02-20"), organizationId: ORG_ID } },
    { path: "invoices/i-vardnad-acconto.json", data: { id: "i-vardnad-acconto", matterId: "m-vardnad", invoiceNumber: "2026-002", type: "ACCONTO", status: "SENT", amountExclVat: 12_000_00, vat: 3_000_00, amountInclVat: 15_000_00, issuedAt: date("2026-03-10"), dueAt: date("2026-04-10"), organizationId: ORG_ID } },
  );

  return all;
}

async function writeAll(root: string, entries: Array<{ path: string; data: unknown }>): Promise<number> {
  for (const entry of entries) {
    const fullPath = resolve(root, entry.path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, JSON.stringify(entry.data, null, 2));
  }
  return entries.length;
}

async function main(): Promise<void> {
  const dirArg = process.argv.indexOf("--dir");
  if (dirArg < 0 || !process.argv[dirArg + 1]) {
    console.error("Användning: yarn tsx scripts/build-demo-repo.ts --dir <path>");
    process.exit(1);
  }
  const dir = resolve(process.argv[dirArg + 1]);
  console.log(`▶ Bygger demo-repo i ${dir}`);

  await mkdir(dir, { recursive: true });
  // Rensa gamla data-mappar (men inte .git eller manifest)
  for (const sub of ["matters", "contacts", "matter-contacts", "documents", "time-entries", "expenses", "invoices", ".ava"]) {
    await rm(resolve(dir, sub), { recursive: true, force: true });
  }
  const entries = buildDemoData();
  const count = await writeAll(dir, entries);

  const counts: Record<string, number> = {};
  for (const e of entries) {
    const top = e.path.split("/")[0];
    counts[top] = (counts[top] ?? 0) + 1;
  }

  await writeFile(resolve(dir, "README.md"), `# AVA Demo Data\n\nFiktiv data för att demonstrera AVA i webbläsaren utan en server.\n\n## Innehåll\n\n${Object.entries(counts).map(([k, v]) => `- ${v} × \`${k}/\``).join("\n")}\n\nAlla namn, personnummer och dokument-innehåll är fiktiva.\n`);

  console.log(`  ✓ ${count} filer skrivna`);
  for (const [k, v] of Object.entries(counts)) console.log(`     ${v} × ${k}/`);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}

export { buildDemoData, writeAll };
