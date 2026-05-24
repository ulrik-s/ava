/**
 * Seed-script för lokal scenario-testning.
 *
 * Populerar databasen (via Prisma) med en realistisk arbetsbörda:
 *   - 1 Organization, 1 Office
 *   - 2 Users (admin + lawyer)
 *   - 10 Contacts (6 klienter + 2 motparter + 1 tingsrätt + 1 motpartsombud)
 *   - 7 Matters med olika status, typer och payment-methods
 *   - MatterContacts som länkar klienter och motparter till ärenden
 *
 * Idempotent: rensar och seed:ar från noll varje gång. Använder kända id:n
 * så Playwright-tester kan referera dem direkt (ingen race på cuid:s).
 *
 * Kör:
 *   yarn tsx tooling/scripts/seed-scenario-data.ts
 *
 * Förväntar DATABASE_URL i miljön (matchar docker-compose:n).
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg(process.env.DATABASE_URL ?? "postgresql://ava:ava_dev_password@localhost:5432/ava?schema=public");
const prisma = new PrismaClient({ adapter });

const ORG_ID = "org-demo-firma";
const OFFICE_ID = "off-stockholm";
const ADMIN_USER_ID = "u-admin";
const LAWYER_USER_ID = "u-anna";

interface SeedContact {
  id: string;
  name: string;
  type: "PERSON" | "COMPANY" | "COURT" | "LAW_FIRM";
  email?: string;
  phone?: string;
  personalNumber?: string;
  orgNumber?: string;
}

const CONTACTS: SeedContact[] = [
  { id: "c-andersson", name: "Lars Andersson", type: "PERSON", email: "lars.andersson@example.se", phone: "070-111 22 33", personalNumber: "19800101-1234" },
  { id: "c-eriksson", name: "Maria Eriksson", type: "PERSON", email: "maria@example.se", phone: "070-222 33 44", personalNumber: "19750505-2345" },
  { id: "c-persson", name: "Karin Persson", type: "PERSON", email: "karin.persson@example.se", phone: "070-333 44 55", personalNumber: "19821010-3456" },
  { id: "c-nilsson", name: "Erik Nilsson", type: "PERSON", email: "erik@example.se", phone: "070-444 55 66", personalNumber: "19700712-4567" },
  { id: "c-johansson", name: "Lena Johansson", type: "PERSON", email: "lena.j@example.se", phone: "070-555 66 77", personalNumber: "19880322-5678" },
  { id: "c-brf-vinkeln", name: "Brf Vinkeln", type: "COMPANY", email: "info@brfvinkeln.se", orgNumber: "769600-1234" },
  { id: "c-motpart-bygg", name: "AB Bygg & Reno", type: "COMPANY", email: "kontakt@byggreno.se", orgNumber: "556899-9876" },
  { id: "c-motpart-eriksson", name: "Stefan Eriksson", type: "PERSON", email: "stefan.e@example.se", personalNumber: "19720815-6789" },
  { id: "c-tingsratten", name: "Stockholms tingsrätt", type: "COURT", email: "stockholms.tingsratt@dom.se", phone: "08-561 670 00" },
  { id: "c-advokat-mp", name: "Advokat Berglund AB", type: "LAW_FIRM", email: "berglund@advokat.se", phone: "08-123 45 67" },
];

interface SeedMatter {
  id: string;
  matterNumber: string;
  title: string;
  description: string;
  matterType: string;
  status: "ACTIVE" | "CLOSED" | "ARCHIVED";
  paymentMethod: "PENDING" | "RATTSHJALP" | "RATTSSKYDD" | "PRIVAT";
  /** Klient + ev. motparter/domstol som ska länkas till ärendet. */
  contacts: Array<{ id: string; role: "KLIENT" | "MOTPART" | "DOMSTOL" | "MOTPARTSOMBUD" }>;
}

const MATTERS: SeedMatter[] = [
  {
    id: "m-vardnad-andersson",
    matterNumber: "2026-001",
    title: "Vårdnad och umgänge — Andersson",
    description: "Klient söker ensam vårdnad om dotter (8 år).",
    matterType: "FAMILJ",
    status: "ACTIVE",
    paymentMethod: "RATTSHJALP",
    contacts: [
      { id: "c-andersson", role: "KLIENT" },
      { id: "c-motpart-eriksson", role: "MOTPART" },
      { id: "c-tingsratten", role: "DOMSTOL" },
      { id: "c-advokat-mp", role: "MOTPARTSOMBUD" },
    ],
  },
  {
    id: "m-arvskifte-eriksson",
    matterNumber: "2026-002",
    title: "Arvskifte — dödsboet efter Eriksson",
    description: "Bouppteckning klar; oenighet kring fastighet.",
    matterType: "ARV",
    status: "ACTIVE",
    paymentMethod: "PRIVAT",
    contacts: [{ id: "c-eriksson", role: "KLIENT" }],
  },
  {
    id: "m-brf-vinkeln-tvist",
    matterNumber: "2026-003",
    title: "Tvist om hyresnivå — Brf Vinkeln",
    description: "Bostadsrättsförening i tvist med entreprenör om garagerenovering.",
    matterType: "FASTIGHET",
    status: "ACTIVE",
    paymentMethod: "PRIVAT",
    contacts: [
      { id: "c-brf-vinkeln", role: "KLIENT" },
      { id: "c-motpart-bygg", role: "MOTPART" },
    ],
  },
  {
    id: "m-bodelning-persson",
    matterNumber: "2026-004",
    title: "Bodelning vid skilsmässa — Persson",
    description: "Sammanboende 12 år; gemensam bostad + pensionsrätt.",
    matterType: "FAMILJ",
    status: "ACTIVE",
    paymentMethod: "RATTSSKYDD",
    contacts: [{ id: "c-persson", role: "KLIENT" }],
  },
  {
    id: "m-fastighet-nilsson",
    matterNumber: "2026-005",
    title: "Köp av fastighet — Nilsson",
    description: "Köpekontrakt + lagfartsansökan + tillträdesgenomgång.",
    matterType: "FASTIGHET",
    status: "CLOSED",
    paymentMethod: "PRIVAT",
    contacts: [{ id: "c-nilsson", role: "KLIENT" }],
  },
  {
    id: "m-arbetsrätt-johansson",
    matterNumber: "2026-006",
    title: "Uppsägning av personliga skäl — Johansson",
    description: "Bestrider uppsägningen, skadeståndsanspråk.",
    matterType: "ARBETSRATT",
    status: "ACTIVE",
    paymentMethod: "RATTSHJALP",
    contacts: [{ id: "c-johansson", role: "KLIENT" }],
  },
  {
    id: "m-konsumenttvist-andersson",
    matterNumber: "2026-007",
    title: "Konsumenttvist — Andersson",
    description: "Reklamation av tjänst hos hantverkare. Konsumenttvistnämnden.",
    matterType: "KONSUMENT",
    status: "ARCHIVED",
    paymentMethod: "PENDING",
    contacts: [{ id: "c-andersson", role: "KLIENT" }],
  },
];

async function main(): Promise<void> {
  console.log("🌱 Seedar scenario-data…");

  // 1. Rensa allt med TRUNCATE CASCADE (enkelt, FK-säkert oavsett schema-tillägg)
  console.log("  Rensar gamla rader…");
  const tableNames = [
    "matter_contacts", "time_entries", "expenses",
    "payment_plan_reminders", "payments", "payment_plans",
    "invoice_acconto_deductions", "invoices",
    "documents", "document_folders",
    "matter_event_suggestions", "document_analysis_suggestions",
    "emails", "matters", "contacts",
    "passkeys", "users", "offices", "organizations",
  ];
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableNames.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);

  // 2. Organization + Office
  console.log("  Skapar organization + office…");
  await prisma.organization.create({
    data: {
      id: ORG_ID,
      name: "Demo Advokatbyrå AB",
      orgNumber: "556123-4567",
      address: "Storgatan 1, 111 23 Stockholm",
      phone: "08-100 100 00",
      email: "info@demo-advokat.se",
      bankgiro: "123-4567",
    },
  });
  await prisma.office.create({
    data: {
      id: OFFICE_ID,
      name: "Stockholm",
      address: "Storgatan 1, 111 23 Stockholm",
      phone: "08-100 100 00",
      isMain: true,
      organizationId: ORG_ID,
    },
  });

  // 3. Users
  console.log("  Skapar users…");
  await prisma.user.createMany({
    data: [
      {
        id: ADMIN_USER_ID, email: "admin@demo-advokat.se", name: "Admin",
        role: "ADMIN", title: "Byrå-administratör", organizationId: ORG_ID,
      },
      {
        id: LAWYER_USER_ID, email: "anna@demo-advokat.se", name: "Anna Andersson",
        role: "LAWYER", title: "Advokat", hourlyRate: 250000, organizationId: ORG_ID,
      },
      // dev@example.com matchar `requireSession`-fallback i NODE_ENV=development
      // → Playwright-tester kan navigera utan att logga in manuellt.
      // hourlyRate krävs för att time-entries ska få rätt belopp i fakturor.
      {
        id: "u-dev", email: "dev@example.com", name: "Dev User",
        role: "ADMIN", title: "Utvecklare", hourlyRate: 250000, organizationId: ORG_ID,
      },
    ],
  });

  // 4. Contacts
  console.log(`  Skapar ${CONTACTS.length} contacts…`);
  await prisma.contact.createMany({
    data: CONTACTS.map((c) => ({
      id: c.id,
      name: c.name,
      contactType: c.type,
      email: c.email ?? null,
      phone: c.phone ?? null,
      personalNumber: c.personalNumber ?? null,
      orgNumber: c.orgNumber ?? null,
      organizationId: ORG_ID,
    })),
  });

  // 5. Matters + MatterContacts
  console.log(`  Skapar ${MATTERS.length} matters…`);
  for (const m of MATTERS) {
    await prisma.matter.create({
      data: {
        id: m.id,
        matterNumber: m.matterNumber,
        title: m.title,
        description: m.description,
        matterType: m.matterType,
        status: m.status,
        paymentMethod: m.paymentMethod,
        organizationId: ORG_ID,
        contacts: {
          create: m.contacts.map((c) => ({
            id: `mc-${m.id}-${c.id}`,
            contactId: c.id,
            role: c.role,
          })),
        },
      },
    });
  }

  console.log("✅ Seed klar.");
  console.log(`   Org:      ${ORG_ID}`);
  console.log(`   Users:    admin@demo-advokat.se, anna@demo-advokat.se`);
  console.log(`   Contacts: ${CONTACTS.length}`);
  console.log(`   Matters:  ${MATTERS.length}`);
}

main()
  .catch((err: unknown) => {
    console.error("❌ Seed misslyckades:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
