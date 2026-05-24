/**
 * seed-demo.ts — genererar testdata för demo
 *
 * Skapar:
 *   - 10 kontakter (om färre finns)
 *   - 5 ärenden med realistiska svenska rubriker + kopplade kontakter
 *   - 30 PDF-dokument med realistiskt juridiskt innehåll
 *   - laddar upp 26 till systemet (lagras + indexeras i Meilisearch)
 *   - sparar 4 som filer i ./reports/reports/demo-pdfs/ för manuell uppladdning under demo
 *
 * Kör med:  node --env-file=.env --experimental-strip-types scripts/seed-demo.ts
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { prisma } from "../../src/server/db.ts";
import { extractText } from "../../src/server/services/tika.ts";
import { indexDocument } from "../../src/server/services/meilisearch.ts";

// ─── Kontakter att skapa (utöver befintliga) ─────────────────────
const demoContacts: Array<{
  name: string;
  contactType: "PERSON" | "COMPANY" | "COURT" | "AUTHORITY" | "OTHER";
  personalNumber?: string;
  orgNumber?: string;
  email?: string;
  phone?: string;
  address?: string;
}> = [
  { name: "Karin Lindström", contactType: "PERSON", personalNumber: "19750612-4433", email: "karin.lindstrom@example.com", phone: "070-1234567" },
  { name: "Bengt Olofsson", contactType: "PERSON", personalNumber: "19601103-8812", email: "bengt.o@example.com", phone: "070-8887766" },
  { name: "Maria Berg", contactType: "PERSON", personalNumber: "19850225-6655", email: "maria.berg@example.com", phone: "070-4455667" },
  { name: "Johan Nilsson", contactType: "PERSON", personalNumber: "19920814-3322", email: "j.nilsson@example.com", phone: "073-1122334" },
  { name: "Eva Persson", contactType: "PERSON", personalNumber: "19701205-9911", email: "eva.p@example.com", phone: "076-5544332" },
  { name: "Lars Ek", contactType: "PERSON", personalNumber: "19550830-7788", email: "lars.ek@example.com", phone: "070-9988776" },
  { name: "Tingsrätten Stockholm", contactType: "COURT", orgNumber: "202100-2627", email: "stockholms.tingsratt@dom.se", phone: "08-561 650 00", address: "Scheelegatan 7, 112 28 Stockholm" },
  { name: "Trygg-Hansa Försäkring AB", contactType: "COMPANY", orgNumber: "516401-7799", email: "kontakt@trygghansa.se", phone: "0771-111 500" },
  { name: "Ek & Partners Revisionsbyrå AB", contactType: "COMPANY", orgNumber: "556677-8899", email: "info@ekpartners.se", phone: "08-123 45 67" },
];

// ─── Ärenden att skapa ───────────────────────────────────────────
type MatterSpec = {
  matterNumber: string;
  title: string;
  description: string;
  matterType: string;
  contacts: Array<{ contactName: string; role: "KLIENT" | "MOTPART" | "MOTPARTSOMBUD" | "DOMSTOL" | "FORSAKRINGSBOLAG" | "VITTNE" }>;
};

const demoMatters: MatterSpec[] = [
  {
    matterNumber: "2026-0002",
    title: "Bodelning Lindström/Olofsson",
    description: "Bodelning efter skilsmässa. Gemensam villa i Nacka värderas till 8,5 Mkr. Tvist om värdet av konstsamling.",
    matterType: "Familjerätt",
    contacts: [
      { contactName: "Karin Lindström", role: "KLIENT" },
      { contactName: "Bengt Olofsson", role: "MOTPART" },
      { contactName: "Tingsrätten Stockholm", role: "DOMSTOL" },
    ],
  },
  {
    matterNumber: "2026-0003",
    title: "Brottmål Berg — misshandel",
    description: "Försvar av Maria Berg, åtalad för misshandel av ringa grad. Huvudförhandling planerad till juni.",
    matterType: "Brottmål",
    contacts: [
      { contactName: "Maria Berg", role: "KLIENT" },
      { contactName: "Tingsrätten Stockholm", role: "DOMSTOL" },
    ],
  },
  {
    matterNumber: "2026-0004",
    title: "Arvstvist efter Gösta Nilsson",
    description: "Klandertalan mot testamente. Klient är en av tre bröstarvingar. Bouppteckning godkänd 2025-11-03.",
    matterType: "Arv och testamente",
    contacts: [
      { contactName: "Johan Nilsson", role: "KLIENT" },
      { contactName: "Lars Ek", role: "MOTPART" },
      { contactName: "Ek & Partners Revisionsbyrå AB", role: "VITTNE" },
    ],
  },
  {
    matterNumber: "2026-0005",
    title: "Försäkringstvist Persson",
    description: "Trafikolycka december 2024. Försäkringsbolaget avslår ersättningskrav på 450 000 kr för personskada.",
    matterType: "Försäkringsrätt",
    contacts: [
      { contactName: "Eva Persson", role: "KLIENT" },
      { contactName: "Trygg-Hansa Försäkring AB", role: "FORSAKRINGSBOLAG" },
    ],
  },
];

// ─── Dokumenttyper med realistiskt svenskt innehåll ──────────────
// Placeholders: {matter}, {client}, {counterparty}, {court}, {date}
type DocSpec = {
  type: string;
  fileName: string;
  title: string;
  body: string[];
};

const docTemplates: DocSpec[] = [
  {
    type: "Kallelse",
    fileName: "kallelse_huvudforhandling.pdf",
    title: "KALLELSE TILL HUVUDFÖRHANDLING",
    body: [
      "Målnummer: {matter}",
      "Part: {client}",
      "Motpart: {counterparty}",
      "",
      "Ni kallas härmed till huvudförhandling i ovan angivet mål. Förhandlingen kommer att äga rum den {date} kl. 09.30 i {court}, sal 2.",
      "",
      "Vid förhandlingen ska parterna och deras ombud vara närvarande. Om någon part uteblir utan laga förfall kan målet komma att avgöras enligt 18 kap. 1 § rättegångsbalken.",
      "",
      "Förhandlingstiden är beräknad till fyra timmar. Vittnen och sakkunniga har kallats separat.",
      "",
      "Handlingar i målet finns tillgängliga hos tingsrättens kansli.",
    ],
  },
  {
    type: "Stämningsansökan",
    fileName: "stamningsansokan.pdf",
    title: "STÄMNINGSANSÖKAN",
    body: [
      "Till {court}",
      "",
      "Kärande: {client}, ombud undertecknad",
      "Svarande: {counterparty}",
      "",
      "YRKANDEN",
      "Käranden yrkar att tingsrätten måtte förplikta svaranden att till käranden utge 325 000 kronor jämte ränta enligt 6 § räntelagen från den {date} till dess full betalning sker.",
      "",
      "GRUNDER FÖR YRKANDET",
      "Mellan parterna har förelegat ett avtal om förskottsbetalning. Svaranden har underlåtit att uppfylla sina förpliktelser enligt avtalet och är därför skyldig att utge ovannämnda belopp.",
      "",
      "BEVISNING",
      "Skriftlig bevisning: Avtal mellan parterna daterat 2024-03-15 samt korrespondens i form av e-post.",
      "Partsförhör med käranden.",
    ],
  },
  {
    type: "Dom",
    fileName: "dom_tingsratten.pdf",
    title: "DOM",
    body: [
      "{court}",
      "Målnummer: {matter}",
      "Meddelad den {date}",
      "",
      "PARTER",
      "Kärande: {client}",
      "Svarande: {counterparty}",
      "",
      "DOMSLUT",
      "1. Tingsrätten förpliktar svaranden att till käranden utge 275 000 kronor jämte ränta enligt 6 § räntelagen från den dag stämningsansökan delgavs svaranden.",
      "2. Svaranden ska ersätta kärandens rättegångskostnader med 48 500 kronor, varav 42 000 kronor avser ombudsarvode.",
      "",
      "BAKGRUND OCH YRKANDEN",
      "Käranden har yrkat att tingsrätten måtte fastställa att svaranden är betalningsskyldig. Svaranden har bestritt yrkandet och gjort gällande att avtal aldrig kommit till stånd.",
      "",
      "DOMSKÄL",
      "Tingsrätten finner efter granskning av den skriftliga bevisningen och partsförhören att käranden visat att avtal förelegat mellan parterna. Svarandens invändningar saknar stöd i utredningen.",
    ],
  },
  {
    type: "Föreläggande",
    fileName: "forelagande.pdf",
    title: "FÖRELÄGGANDE",
    body: [
      "Från: {court}",
      "Målnummer: {matter}",
      "",
      "Tingsrätten förelägger {counterparty} att inom tre veckor från mottagandet av detta föreläggande inkomma med skriftligt svaromål.",
      "",
      "I svaromålet ska anges:",
      "1. i vilken utsträckning yrkandena medges eller bestrids,",
      "2. de grunder som åberopas,",
      "3. den bevisning som åberopas och vad som ska styrkas med varje bevis.",
      "",
      "Om svaromål inte inkommer i tid kan tredskodom meddelas enligt 44 kap. rättegångsbalken.",
      "",
      "Föreläggandet utgår från {date}.",
    ],
  },
  {
    type: "Yttrande",
    fileName: "yttrande.pdf",
    title: "YTTRANDE",
    body: [
      "Till {court}",
      "Målnummer: {matter}",
      "Ombud för {client}",
      "",
      "Angående motpartens yttrande av den {date} anförs följande.",
      "",
      "Motpartens framställning av händelseförloppet är i väsentliga delar felaktig. Min huvudman har vid upprepade tillfällen och i skrift försökt nå en samförståndslösning utan framgång.",
      "",
      "Vad gäller värderingen av de tvistiga tillgångarna är motpartens bedömning orimligt låg. Den värdering som huvudmannen åberopar utförd av auktoriserad värderingsman ska därför läggas till grund för bedömningen.",
      "",
      "I övrigt vidhåller huvudmannen vad som tidigare anförts.",
    ],
  },
  {
    type: "Uppdragsavtal",
    fileName: "uppdragsavtal.pdf",
    title: "UPPDRAGSAVTAL",
    body: [
      "Mellan {client} (nedan klienten) och undertecknad advokat träffas härmed följande avtal om juridiskt uppdrag.",
      "",
      "UPPDRAGETS OMFATTNING",
      "Advokaten åtar sig att biträda klienten i ärendet rörande {matter}. Uppdraget omfattar rådgivning, korrespondens med motparten, upprättande av handlingar samt processföring i domstol.",
      "",
      "ARVODE",
      "Arvode debiteras enligt löpande räkning med en timtaxa om 2 500 kronor exklusive mervärdesskatt. Utlägg för t.ex. domstolsavgifter debiteras separat.",
      "",
      "Klienten kan komma att förpliktas att ersätta motpartens rättegångskostnader om klienten förlorar en rättsprocess.",
      "",
      "Avtalet träder i kraft den {date}.",
    ],
  },
  {
    type: "Fullmakt",
    fileName: "fullmakt.pdf",
    title: "FULLMAKT",
    body: [
      "Härmed ger jag, {client}, undertecknad advokat fullmakt att i mitt namn och för min räkning företräda mig i alla rättsliga angelägenheter rörande {matter}.",
      "",
      "Fullmakten omfattar rätt att:",
      "— föra min talan vid domstolar och myndigheter i alla instanser,",
      "— motta och erlägga betalningar,",
      "— ingå förlikning på mina vägnar,",
      "— överklaga domar och beslut,",
      "— i övrigt vidta alla åtgärder som uppdraget kräver.",
      "",
      "Fullmakten gäller från den {date} tills den återkallas skriftligen.",
    ],
  },
  {
    type: "Bouppteckning",
    fileName: "bouppteckning.pdf",
    title: "BOUPPTECKNING",
    body: [
      "Efter Gösta Nilsson, personnummer 19350418-1234",
      "Avliden den 2025-09-14",
      "Bouppteckning förrättad den {date}",
      "",
      "DÖDSBODELÄGARE",
      "1. {client} — son, 1/3",
      "2. Syster Ingrid Nilsson — 1/3",
      "3. Bror {counterparty} — 1/3",
      "",
      "TILLGÅNGAR",
      "Bostadsrätt i Vasastan, uppskattat värde: 6 200 000 kr",
      "Banktillgodohavanden Handelsbanken: 485 000 kr",
      "Fondandelar: 1 120 000 kr",
      "Inre lösöre: 95 000 kr",
      "",
      "SKULDER",
      "Begravningskostnader: 58 000 kr",
      "Övriga skulder: 12 000 kr",
      "",
      "BEHÅLLNING",
      "Total behållning i boet: 7 832 000 kr",
    ],
  },
  {
    type: "Beslut",
    fileName: "beslut.pdf",
    title: "BESLUT",
    body: [
      "{court}",
      "Målnummer: {matter}",
      "Meddelat den {date}",
      "",
      "SAKEN",
      "Interimistiskt beslut om boende enligt 6 kap. 20 § föräldrabalken.",
      "",
      "TINGSRÄTTENS BESLUT",
      "Barnet ska interimistiskt bo tillsammans med {client} till dess att frågan prövas slutligt.",
      "",
      "SKÄL FÖR BESLUTET",
      "Tingsrätten finner efter en samlad bedömning att barnets bästa för närvarande är att bo hos sökanden. Ett interimistiskt beslut är nödvändigt med hänsyn till situationens akuta karaktär.",
    ],
  },
  {
    type: "Överklagan",
    fileName: "overklagan.pdf",
    title: "ÖVERKLAGANDE AV DOM",
    body: [
      "Till Svea hovrätt",
      "Via {court}",
      "Målnummer i tingsrätten: {matter}",
      "",
      "Klagande: {client}",
      "Motpart: {counterparty}",
      "",
      "YRKANDEN I HOVRÄTTEN",
      "Klaganden yrkar att hovrätten, med ändring av tingsrättens dom, i första hand ogillar kärandens talan och i andra hand nedsätter det belopp som klaganden förpliktats att utge.",
      "",
      "GRUNDER",
      "Tingsrätten har felaktigt värderat den skriftliga bevisningen. Utredningen styrker inte att avtal i formell mening kommit till stånd mellan parterna.",
      "",
      "Överklagandet har inkommit inom den lagstadgade tiden om tre veckor.",
    ],
  },
  {
    type: "Protokoll",
    fileName: "protokoll.pdf",
    title: "PROTOKOLL",
    body: [
      "Fört vid sammanträde för muntlig förberedelse",
      "{court}, Målnummer: {matter}",
      "Datum: {date}",
      "",
      "NÄRVARANDE",
      "Ordförande: Rådmannen Anna Karlsson",
      "Kärande: {client}, genom ombud",
      "Svarande: {counterparty}, genom ombud",
      "",
      "FÖRHANDLINGENS GÅNG",
      "Parterna har gått igenom sina respektive ståndpunkter. Ordföranden har påpekat att vissa sakfrågor framstår som ostridiga och att tvisten främst rör bedömningen av värderingen.",
      "",
      "Parterna har förklarat sig beredda att medverka till medling. Tingsrätten beslutar att medlingssammanträde ska hållas den 15 maj 2026.",
    ],
  },
  {
    type: "Avtal",
    fileName: "avtal.pdf",
    title: "AVTAL OM FÖRLIKNING",
    body: [
      "Mellan {client} (Part A) och {counterparty} (Part B) träffas följande avtal.",
      "",
      "1. PARTERNA ÄR ENSE OM FÖLJANDE",
      "Part B ska till Part A utge sammanlagt 180 000 kronor i förlikning av samtliga ekonomiska anspråk mellan parterna i ärendet {matter}.",
      "",
      "2. BETALNING",
      "Beloppet ska erläggas senast 30 dagar efter undertecknande av detta avtal till Part A:s klientmedelskonto.",
      "",
      "3. INVERKAN PÅ MÅLET",
      "Parterna åtar sig att tillsammans meddela tingsrätten att talan återkallas. Vardera parten står sina egna rättegångskostnader.",
      "",
      "4. SEKRETESS",
      "Avtalets innehåll omfattas av sekretess mellan parterna.",
      "",
      "Avtalet undertecknas den {date}.",
    ],
  },
  {
    type: "Bevisuppgift",
    fileName: "bevisuppgift.pdf",
    title: "BEVISUPPGIFT",
    body: [
      "Till {court}",
      "Målnummer: {matter}",
      "Ombud för {client}",
      "",
      "SKRIFTLIG BEVISNING",
      "1. Avtal daterat 2024-03-15 — ska styrka avtalsförhållande mellan parterna.",
      "2. Korrespondens via e-post mellan parterna 2024-04 till 2024-11 — ska styrka att svaranden bekräftat avtalets innehåll.",
      "3. Kontoutdrag från Handelsbanken — ska styrka att betalning aldrig erlagts.",
      "",
      "MUNTLIG BEVISNING",
      "1. Partsförhör med käranden — angående avtalets tillkomst och parternas avsikter.",
      "2. Vittnesförhör med Karin Lindqvist — angående förhandlingarna som föregick avtalet.",
      "",
      "Bevisuppgiften lämnas den {date}.",
    ],
  },
  {
    type: "Intyg",
    fileName: "intyg.pdf",
    title: "INTYG",
    body: [
      "Härmed intygas att {client} den {date} personligen besökt undertecknad och undertecknat fullmakt rörande ärendet {matter}.",
      "",
      "Identitet har styrkts genom giltigt pass. {client} har bedömts vara vid sina sinnens fulla bruk och förstått innebörden av fullmakten.",
      "",
      "Intyget har upprättats i två likalydande exemplar, varav ett har överlämnats till {client}.",
    ],
  },
  {
    type: "Vittnesförhör",
    fileName: "vittnesforhor.pdf",
    title: "PROTOKOLL FRÅN VITTNESFÖRHÖR",
    body: [
      "{court}, Målnummer: {matter}",
      "Datum: {date}",
      "",
      "VITTNE",
      "Namn: Lena Fredriksson",
      "Personnummer: 19720914-4455",
      "Relation till parterna: Tidigare granne",
      "",
      "FÖRHÖRET",
      "Vittnet har på fråga från kärandens ombud uppgett att hon vid flera tillfällen under hösten 2024 hört parterna diskutera avtalet. Hon har klart uppfattat att svaranden bekräftade sina åtaganden.",
      "",
      "På fråga från svarandens ombud har vittnet uppgett att hon inte varit närvarande vid själva undertecknandet av någon handling.",
      "",
      "Vittnet har hörts under ed och har påmints om vikten av att tala sanning.",
    ],
  },
];

// ─── PDF-generering ──────────────────────────────────────────────
async function renderPdf(spec: {
  title: string;
  matter: string;
  client: string;
  counterparty: string;
  court: string;
  date: string;
  body: string[];
}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const margin = 60;
  const width = page.getWidth() - 2 * margin;
  let y = page.getHeight() - margin;

  // Rubrik
  page.drawText(spec.title, {
    x: margin,
    y,
    size: 16,
    font: bold,
    color: rgb(0, 0, 0),
  });
  y -= 30;

  // Undertext (ärendenummer)
  page.drawText(`Ärende: ${spec.matter}`, {
    x: margin,
    y,
    size: 10,
    font,
    color: rgb(0.35, 0.35, 0.35),
  });
  y -= 25;

  // Horisontell linje
  page.drawLine({
    start: { x: margin, y },
    end: { x: margin + width, y },
    thickness: 0.5,
    color: rgb(0.6, 0.6, 0.6),
  });
  y -= 20;

  // Ersätt placeholders i body och rita
  const lineHeight = 14;
  const fontSize = 10;

  for (const rawLine of spec.body) {
    const line = rawLine
      .replaceAll("{matter}", spec.matter)
      .replaceAll("{client}", spec.client)
      .replaceAll("{counterparty}", spec.counterparty)
      .replaceAll("{court}", spec.court)
      .replaceAll("{date}", spec.date);

    // Enkel wrap: klipp ord vid ca 85 tecken
    const wrapped = wrapText(line, 85);
    for (const w of wrapped) {
      if (y < margin + 40) break;
      page.drawText(w, { x: margin, y, size: fontSize, font, color: rgb(0, 0, 0) });
      y -= lineHeight;
    }
  }

  // Fotnot
  page.drawText(`Genererat ${spec.date} • AVA Advokatbyrå`, {
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

// ─── Hjälpare: skapa dokument i DB + på disk + i Meili ───────────
async function uploadDocument(params: {
  matterId: string;
  matterNumber: string;
  matterTitle: string;
  organizationId: string;
  uploadedById: string;
  fileName: string;
  buffer: Buffer;
}) {
  const storagePath = process.env.DOCUMENT_STORAGE_PATH || "./data/storage/documents";
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

  // Extrahera text + indexera (ej blockerande om Tika/Meili nere)
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

// ─── Main ────────────────────────────────────────────────────────
async function main() {
  console.log("🌱 Seedar demo-data...\n");

  // 1. Hämta eller skapa organisation + dev-user
  const org = await prisma.organization.findFirstOrThrow();
  const user = await prisma.user.findFirstOrThrow({ where: { email: "dev@example.com" } });
  console.log(`✓ Organisation: ${org.name}`);
  console.log(`✓ Användare: ${user.name}\n`);

  // 2. Skapa saknade kontakter
  console.log("👥 Skapar kontakter...");
  for (const c of demoContacts) {
    const existing = await prisma.contact.findFirst({
      where: { name: c.name, organizationId: org.id },
    });
    if (existing) {
      console.log(`  — ${c.name} finns redan`);
      continue;
    }
    await prisma.contact.create({
      data: { ...c, organizationId: org.id },
    });
    console.log(`  + ${c.name}`);
  }
  console.log();

  // 3. Skapa saknade ärenden + koppla kontakter
  console.log("📁 Skapar ärenden...");
  const matterIdByNumber = new Map<string, string>();
  for (const m of demoMatters) {
    let matter = await prisma.matter.findUnique({ where: { matterNumber: m.matterNumber } });
    const isNew = !matter;
    if (!matter) {
      matter = await prisma.matter.create({
        data: {
          matterNumber: m.matterNumber,
          title: m.title,
          description: m.description,
          matterType: m.matterType,
          organizationId: org.id,
        },
      });
    }
    matterIdByNumber.set(m.matterNumber, matter.id);

    // Säkerställ att alla kontakter är kopplade (idempotent — hoppar över befintliga)
    let linkCount = 0;
    for (const link of m.contacts) {
      const contact = await prisma.contact.findFirst({
        where: { name: link.contactName, organizationId: org.id },
      });
      if (!contact) {
        console.log(`    ⚠ Kontakten "${link.contactName}" hittades ej`);
        continue;
      }
      const existingLink = await prisma.matterContact.findFirst({
        where: { matterId: matter.id, contactId: contact.id, role: link.role },
      });
      if (!existingLink) {
        await prisma.matterContact.create({
          data: { matterId: matter.id, contactId: contact.id, role: link.role },
        });
        linkCount++;
      }
    }
    const tag = isNew ? "+" : "~";
    const suffix = isNew ? "" : ` (+${linkCount} kontakter)`;
    console.log(`  ${tag} ${m.matterNumber} ${m.title}${suffix}`);
  }
  console.log();

  // 4. Inkludera befintligt ärende så vi kan distribuera docs över alla 5
  const allMatters = await prisma.matter.findMany({ orderBy: { matterNumber: "asc" } });
  console.log(`📊 Totalt ${allMatters.length} ärenden, distribuerar 30 dokument över dem\n`);

  // 5. Generera 30 dokument-specar genom att cykla genom mallarna
  type Job = { matterId: string; matterNumber: string; matterTitle: string; pdfSpec: Parameters<typeof renderPdf>[0]; fileName: string; type: string };
  const jobs: Job[] = [];
  for (let i = 0; i < 30; i++) {
    const template = docTemplates[i % docTemplates.length];
    const matter = allMatters[i % allMatters.length];

    // Hämta huvudman och motpart för ärendet
    const huvudman = await prisma.matterContact.findFirst({
      where: { matterId: matter.id, role: "KLIENT" },
      include: { contact: true },
    });
    const motpart = await prisma.matterContact.findFirst({
      where: { matterId: matter.id, role: "MOTPART" },
      include: { contact: true },
    });
    const domstol = await prisma.matterContact.findFirst({
      where: { matterId: matter.id, role: "DOMSTOL" },
      include: { contact: true },
    });

    const client = huvudman?.contact.name ?? "okänd huvudman";
    const counterparty = motpart?.contact.name ?? "okänd motpart";
    const court = domstol?.contact.name ?? "Stockholms tingsrätt";

    // Variera datum: dagens datum minus 0-180 dagar
    const daysAgo = Math.floor(Math.random() * 180);
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    const dateStr = d.toISOString().slice(0, 10);

    // Sekvensnummer på filnamnet för att undvika krock
    const seq = Math.floor(i / docTemplates.length) + 1;
    const fileName = seq > 1
      ? template.fileName.replace(".pdf", `_${seq}.pdf`)
      : template.fileName;

    jobs.push({
      matterId: matter.id,
      matterNumber: matter.matterNumber,
      matterTitle: matter.title,
      type: template.type,
      fileName,
      pdfSpec: {
        title: template.title,
        matter: matter.matterNumber,
        client,
        counterparty,
        court,
        date: dateStr,
        body: template.body,
      },
    });
  }

  // 6. Ladda upp 26 till systemet
  console.log("📄 Genererar och laddar upp 26 dokument...");
  const toUpload = jobs.slice(0, 26);
  for (const job of toUpload) {
    const buf = await renderPdf(job.pdfSpec);
    await uploadDocument({
      matterId: job.matterId,
      matterNumber: job.matterNumber,
      matterTitle: job.matterTitle,
      organizationId: org.id,
      uploadedById: user.id,
      fileName: job.fileName,
      buffer: buf,
    });
    console.log(`  + [${job.matterNumber}] ${job.type} — ${job.fileName}`);
  }
  console.log();

  // 7. Spara 4 som filer i reports/demo-pdfs/ (utan prefix)
  console.log("💾 Sparar 4 demo-PDF:er i ./reports/reports/demo-pdfs/ ...");
  const demoDir = path.resolve("./reports/demo-pdfs");
  await mkdir(demoDir, { recursive: true });
  const demoJobs = jobs.slice(26, 30);
  for (const job of demoJobs) {
    const buf = await renderPdf(job.pdfSpec);
    // Unikt filnamn som är beskrivande
    const demoName = `${job.type.toLowerCase()}_${job.matterNumber}_${job.fileName}`;
    const demoPath = path.join(demoDir, demoName);
    await writeFile(demoPath, buf);
    console.log(`  → ${demoPath}`);
  }
  console.log();

  // Slutsammanfattning
  const finalContacts = await prisma.contact.count({ where: { organizationId: org.id } });
  const finalMatters = await prisma.matter.count({ where: { organizationId: org.id } });
  const finalDocs = await prisma.document.count({
    where: { matter: { organizationId: org.id } },
  });

  console.log("✅ Klart!");
  console.log(`   ${finalContacts} kontakter, ${finalMatters} ärenden, ${finalDocs} uppladdade dokument`);
  console.log(`   4 demo-PDF:er finns i ./reports/reports/demo-pdfs/ — ladda upp dem manuellt under demo\n`);
}

main()
  .catch((err) => {
    console.error("❌ Fel under seed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
