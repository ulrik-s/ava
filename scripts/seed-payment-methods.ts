/**
 * seed-payment-methods.ts — genererar PDF:er och sätter paymentMethod på
 * demo-ärenden.
 *
 * Skapar:
 *   • 2026-0002 Bodelning → RATTSHJALP + rättshjälpsbeslut.pdf
 *   • 2026-0005 Försäkringstvist → RATTSSKYDD + rättsskyddsbesked.pdf (Trygg-Hansa)
 *   • 2026-0003 Brottmål → OFFENTLIG_FORSVARARE + forordnande_offentlig_forsvarare.pdf
 *   • 2026-0004 Arvstvist → PRIVAT (finansiering_privat.pdf — egen finansiering)
 *
 * Idempotent: hoppar över PDF:er som redan finns på ärendet.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { prisma } from "../src/server/db.ts";
import { extractText } from "../src/server/services/tika.ts";
import { indexDocument } from "../src/server/services/meilisearch.ts";

type DocSpec = {
  title: string;
  subtitle: string;
  body: string[];
};

// ─── PDF-rendering (samma grundlayout som seed-demo.ts) ──────────

async function renderPdf(spec: DocSpec & { matterNumber: string }): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const margin = 60;
  const width = page.getWidth() - 2 * margin;
  let y = page.getHeight() - margin;

  page.drawText(spec.title, { x: margin, y, size: 16, font: bold, color: rgb(0, 0, 0) });
  y -= 24;
  page.drawText(spec.subtitle, { x: margin, y, size: 11, font, color: rgb(0.35, 0.35, 0.35) });
  y -= 20;
  page.drawLine({
    start: { x: margin, y },
    end: { x: margin + width, y },
    thickness: 0.5,
    color: rgb(0.6, 0.6, 0.6),
  });
  y -= 20;

  for (const rawLine of spec.body) {
    const wrapped = wrapText(rawLine, 85);
    for (const w of wrapped) {
      if (y < margin + 40) break;
      page.drawText(w, { x: margin, y, size: 10, font, color: rgb(0, 0, 0) });
      y -= 14;
    }
  }

  page.drawText(`Ärende ${spec.matterNumber} · AVA Advokatbyrå`, {
    x: margin,
    y: margin / 2,
    size: 8,
    font,
    color: rgb(0.55, 0.55, 0.55),
  });

  return Buffer.from(await doc.save());
}

function wrapText(text: string, maxChars: number): string[] {
  if (text === "") return [""];
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if (current.length + w.length + 1 > maxChars) {
      if (current) lines.push(current);
      current = w;
    } else {
      current = current ? `${current} ${w}` : w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ─── PDF-mallar per betalningssätt ───────────────────────────────

const pdfTemplates = {
  rattshjalp: {
    fileName: "rattshjalpsbeslut.pdf",
    title: "BESLUT OM RÄTTSHJÄLP",
    subtitle: "Rättshjälpsmyndigheten",
    body: [
      "Diarienummer: RH-2026-{nr}",
      "Beslutsdatum: {date}",
      "",
      "SÖKANDE",
      "{client}",
      "",
      "BESLUT",
      "Rättshjälpsmyndigheten beviljar rättshjälp i ärendet {matter}.",
      "",
      "VILLKOR",
      "— Rättshjälpsavgift: 5 procent av kostnaden, dock lägst 0 kr och högst 5 000 kr.",
      "— Maximalt antal timmar: 100 timmar enligt rättshjälpstaxa.",
      "— Timkostnadsnorm: 1 845 kr exkl. moms.",
      "",
      "MOTIVERING",
      "Sökanden har styrkt behov av juridiskt biträde och uppfyller de ekonomiska",
      "villkoren enligt 6 § rättshjälpslagen. Ärendet är av sådan karaktär att",
      "rättshjälp bör beviljas.",
      "",
      "OMBUD",
      "Advokat Anna Karlsson, AVA Advokatbyrå, förordnas som ombud.",
      "",
      "ÖVERKLAGANDE",
      "Beslutet kan överklagas till förvaltningsrätten inom tre veckor.",
    ],
  },
  rattsskydd: {
    fileName: "rattsskyddsbesked.pdf",
    title: "BESKED OM RÄTTSSKYDD",
    subtitle: "Trygg-Hansa Försäkring AB",
    body: [
      "Skadenummer: TH-2026-{nr}",
      "Försäkringstagare: {client}",
      "Försäkring: Hemförsäkring Bas, nr 4455-127-{nr}",
      "Beslutsdatum: {date}",
      "",
      "BESKED",
      "Rättsskydd beviljas för tvisten i ärendet {matter}.",
      "",
      "VILLKOR",
      "— Högsta ersättning: 75 000 kr inklusive moms.",
      "— Självrisk: 25 procent av kostnaden, dock minst 1 500 kr.",
      "— Ersättning utgår för ombudskostnader samt rättegångskostnader.",
      "— Timpris upp till gällande rättshjälpstaxa.",
      "",
      "VILLKOR FÖR UTBETALNING",
      "Fakturering sker mot uppvisande av slutlig räkning från ombudet tillsammans",
      "med kopia på dom eller förlikningsavtal. Delbetalning kan ske mot",
      "löpande räkning efter särskild överenskommelse.",
      "",
      "OMBUD",
      "Godkänt ombud: Advokat Anna Karlsson, AVA Advokatbyrå.",
      "",
      "Kontaktperson hos Trygg-Hansa: Skaderegleraren Maria Svensson, 0771-111 500.",
    ],
  },
  offentligForsvarare: {
    fileName: "forordnande_offentlig_forsvarare.pdf",
    title: "FÖRORDNANDE AV OFFENTLIG FÖRSVARARE",
    subtitle: "Stockholms tingsrätt",
    body: [
      "Målnummer: B 2026-{nr}",
      "Beslutsdatum: {date}",
      "",
      "TILLTALAD",
      "{client}",
      "",
      "BESLUT",
      "Tingsrätten förordnar advokat Erik Lundberg, AVA Advokatbyrå, som offentlig",
      "försvarare för den tilltalade i målet {matter}.",
      "",
      "ARVODE",
      "Arvode utgår enligt brottmålstaxan med timkostnadsnorm 1 845 kr exkl. moms.",
      "Försvararen ska inge kostnadsräkning vid avgörande av målet.",
      "",
      "Beslutet meddelas med stöd av 21 kap. 4 § rättegångsbalken.",
    ],
  },
  privat: {
    fileName: "finansiering_privat.pdf",
    title: "NOTERING — PRIVAT FINANSIERING",
    subtitle: "Internt dokument",
    body: [
      "Ärende: {matter}",
      "Klient: {client}",
      "Datum: {date}",
      "",
      "FINANSIERINGSBESLUT",
      "Klienten har meddelat att denne avser att finansiera ärendet privat.",
      "",
      "UTREDNING",
      "— Ansökan om rättshjälp: ej aktuell (ekonomiska villkoren ej uppfyllda,",
      "  klienten har inkomst över gränsen om 260 000 kr/år).",
      "— Rättsskydd via försäkring: ej aktuell (tvistiga arvsfrågor omfattas ej",
      "  av hemförsäkringens rättsskyddsmoment).",
      "",
      "ÖVERENSKOMMELSE",
      "Löpande räkning enligt uppdragsavtal, timtaxa 3 000 kr exkl. moms.",
      "Acconto om 10 000 kr debiteras vid uppstart, sedan månadsvis fakturering.",
      "",
      "KREDITRISK",
      "Klienten har kreditupplysning utan anmärkningar. Ekonomin stark enligt",
      "uppgiven information. Bedöms som medel risk — följ upp betalningsvilja",
      "löpande och avbryt arbete om räkning inte betalas inom 30 dagar.",
    ],
  },
} satisfies Record<string, DocSpec & { fileName: string }>;

// ─── Plan per ärende ─────────────────────────────────────────────

const matterPlan: Array<{
  matterNumber: string;
  paymentMethod: "RATTSHJALP" | "RATTSSKYDD" | "OFFENTLIG_FORSVARARE" | "PRIVAT";
  decidedDaysAgo: number;
  note: string;
  template: keyof typeof pdfTemplates;
}> = [
  {
    matterNumber: "2026-0002",
    paymentMethod: "RATTSHJALP",
    decidedDaysAgo: 50,
    note: "Rättshjälp beviljad 5%-nivå · Diarienr RH-2026-0217 · Tak 100 timmar",
    template: "rattshjalp",
  },
  {
    matterNumber: "2026-0005",
    paymentMethod: "RATTSSKYDD",
    decidedDaysAgo: 100,
    note: "Trygg-Hansa · Skadenr TH-2026-0045 · Självrisk 25% · Maxbelopp 75 000 kr",
    template: "rattsskydd",
  },
  {
    matterNumber: "2026-0003",
    paymentMethod: "OFFENTLIG_FORSVARARE",
    decidedDaysAgo: 65,
    note: "Stockholms tingsrätt · Målnr B 2026-0892 · Brottmålstaxa",
    template: "offentligForsvarare",
  },
  {
    matterNumber: "2026-0004",
    paymentMethod: "PRIVAT",
    decidedDaysAgo: 85,
    note: "Klient betalar själv · Timtaxa 3 000 kr · Acconto 10 000 kr debiteras",
    template: "privat",
  },
];

// ─── Main ────────────────────────────────────────────────────────

async function uploadDocument(params: {
  matterId: string;
  matterNumber: string;
  matterTitle: string;
  organizationId: string;
  uploadedById: string;
  fileName: string;
  buffer: Buffer;
}) {
  const storagePath = process.env.DOCUMENT_STORAGE_PATH || "./storage/documents";
  const docId = crypto.randomUUID();
  const dirPath = path.join(storagePath, params.matterId, docId);
  await mkdir(dirPath, { recursive: true });
  const filePath = path.join(dirPath, params.fileName);
  await writeFile(filePath, params.buffer);

  const document = await prisma.document.create({
    data: {
      fileName: params.fileName,
      mimeType: "application/pdf",
      fileSize: params.buffer.length,
      storagePath: filePath,
      matterId: params.matterId,
      uploadedById: params.uploadedById,
    },
  });

  try {
    const content = await extractText(params.buffer, "application/pdf");
    await indexDocument({
      id: document.id,
      fileName: params.fileName,
      content,
      matterId: params.matterId,
      matterNumber: params.matterNumber,
      matterTitle: params.matterTitle,
      organizationId: params.organizationId,
    });
  } catch (err) {
    console.warn(`  ⚠ Kunde inte indexera ${params.fileName}:`, (err as Error).message);
  }

  return document;
}

async function main() {
  console.log("💰 Seedar betalningssätt + styrkedokument…\n");

  const org = await prisma.organization.findFirstOrThrow();
  const user = await prisma.user.findUniqueOrThrow({ where: { email: "dev@example.com" } });

  for (const plan of matterPlan) {
    const matter = await prisma.matter.findUnique({ where: { matterNumber: plan.matterNumber } });
    if (!matter) {
      console.log(`  ⚠ ${plan.matterNumber} saknas — hoppar över`);
      continue;
    }

    // 1. Uppdatera paymentMethod
    const decidedAt = new Date();
    decidedAt.setDate(decidedAt.getDate() - plan.decidedDaysAgo);
    decidedAt.setHours(0, 0, 0, 0);

    await prisma.matter.update({
      where: { id: matter.id },
      data: {
        paymentMethod: plan.paymentMethod,
        paymentMethodNote: plan.note,
        paymentMethodDecidedAt: decidedAt,
      },
    });
    console.log(`  ✓ ${plan.matterNumber} → ${plan.paymentMethod}`);

    // 2. Generera + ladda upp PDF (om inte redan finns)
    const template = pdfTemplates[plan.template];
    const existingDoc = await prisma.document.findFirst({
      where: { matterId: matter.id, fileName: template.fileName },
    });
    if (existingDoc) {
      console.log(`    ~ ${template.fileName} finns redan`);
      continue;
    }

    const clientLink = await prisma.matterContact.findFirst({
      where: { matterId: matter.id, role: "KLIENT" },
      include: { contact: true },
    });
    const clientName = clientLink?.contact.name ?? "Okänd klient";

    // nr = sekvens i matternumret för dokument-id
    const nrSuffix = plan.matterNumber.split("-")[1];
    const body = template.body.map((line) =>
      line
        .replaceAll("{client}", clientName)
        .replaceAll("{matter}", matter.title)
        .replaceAll("{date}", decidedAt.toISOString().slice(0, 10))
        .replaceAll("{nr}", nrSuffix),
    );

    const buf = await renderPdf({
      title: template.title,
      subtitle: template.subtitle,
      body,
      matterNumber: plan.matterNumber,
    });
    await uploadDocument({
      matterId: matter.id,
      matterNumber: plan.matterNumber,
      matterTitle: matter.title,
      organizationId: org.id,
      uploadedById: user.id,
      fileName: template.fileName,
      buffer: buf,
    });
    console.log(`    + ${template.fileName}`);
  }

  console.log(`\n✅ Klart!`);
}

main()
  .catch((err) => {
    console.error("❌ Fel under seed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
