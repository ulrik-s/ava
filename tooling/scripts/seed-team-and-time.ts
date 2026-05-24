/**
 * seed-team-and-time.ts — utökar demo-data med team, motpartsombud, åklagare,
 * tidregistreringar och utlägg.
 *
 * Idempotent: hoppar över poster som redan finns.
 *
 * Kör med:  DATABASE_URL=... npx tsx tooling/scripts/seed-team-and-time.ts
 */

import { hash } from "bcryptjs";
import { prisma } from "../../src/server/db.ts";

// ─── Advokater / team ────────────────────────────────────────────

const teamMembers: Array<{
  email: string;
  name: string;
  title: string;
  role: "ADMIN" | "LAWYER" | "ASSISTANT";
  hourlyRate: number; // kr/h (heltal SEK)
  mileageRate: number; // öre/km
  password: string;
}> = [
  {
    email: "anna.karlsson@ava.se",
    name: "Anna Karlsson",
    title: "Advokat",
    role: "LAWYER",
    hourlyRate: 3000,
    mileageRate: 2500, // 25 kr/km
    password: "demo1234",
  },
  {
    email: "erik.lundberg@ava.se",
    name: "Erik Lundberg",
    title: "Advokat",
    role: "LAWYER",
    hourlyRate: 2800,
    mileageRate: 2500,
    password: "demo1234",
  },
  {
    email: "sofia.bergstrom@ava.se",
    name: "Sofia Bergström",
    title: "Biträdande jurist",
    role: "ASSISTANT",
    hourlyRate: 1800,
    mileageRate: 2500,
    password: "demo1234",
  },
];

// ─── Motpartsombud + åklagare ────────────────────────────────────

const externalCounsel: Array<{
  name: string;
  contactType: "PERSON" | "COMPANY" | "AUTHORITY" | "LAW_FIRM";
  orgNumber?: string;
  personalNumber?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
}> = [
  {
    name: "Advokatfirman Holmgren AB",
    contactType: "LAW_FIRM",
    orgNumber: "556612-3344",
    email: "info@holmgren-advokat.se",
    phone: "08-555 12 34",
    address: "Kungsgatan 22, 111 35 Stockholm",
  },
  {
    name: "Mattias Holmgren",
    contactType: "PERSON",
    email: "mattias@holmgren-advokat.se",
    phone: "070-555 12 35",
    notes: "Advokat hos Advokatfirman Holmgren AB — företräder motparter i familjerätt",
  },
  {
    name: "Advokatfirman Vinge KB",
    contactType: "LAW_FIRM",
    orgNumber: "969613-2772",
    email: "stockholm@vinge.se",
    phone: "08-614 30 00",
    address: "Stureplan 8, 114 35 Stockholm",
  },
  {
    name: "Helena Wahlgren",
    contactType: "PERSON",
    email: "helena.wahlgren@vinge.se",
    phone: "070-888 44 21",
    notes: "Advokat hos Advokatfirman Vinge — företräder försäkringsbolag",
  },
  {
    name: "Åklagarmyndigheten Stockholm",
    contactType: "AUTHORITY",
    orgNumber: "202100-5826",
    email: "registrator.stockholm@aklagare.se",
    phone: "010-562 50 00",
    address: "Östermalmsgatan 87, 114 59 Stockholm",
  },
  {
    name: "Per Johansson",
    contactType: "PERSON",
    email: "per.johansson@aklagare.se",
    phone: "010-562 51 22",
    notes: "Kammaråklagare vid Åklagarmyndigheten Stockholm",
  },
];

// Koppla externa parter till befintliga ärenden
const counselLinks: Array<{
  matterNumber: string;
  contactName: string;
  role: "MOTPARTSOMBUD" | "AKLAGARE";
}> = [
  { matterNumber: "2026-0002", contactName: "Advokatfirman Holmgren AB", role: "MOTPARTSOMBUD" },
  { matterNumber: "2026-0002", contactName: "Mattias Holmgren", role: "MOTPARTSOMBUD" },
  { matterNumber: "2026-0005", contactName: "Advokatfirman Vinge KB", role: "MOTPARTSOMBUD" },
  { matterNumber: "2026-0005", contactName: "Helena Wahlgren", role: "MOTPARTSOMBUD" },
  { matterNumber: "2026-0003", contactName: "Åklagarmyndigheten Stockholm", role: "AKLAGARE" },
  { matterNumber: "2026-0003", contactName: "Per Johansson", role: "AKLAGARE" },
];

// ─── Tidregistreringar ───────────────────────────────────────────
// Realistiska entries per ärende, spridda i tid och på olika advokater.
// `userEmail` matchas mot teamet; `relativeDaysAgo` räknas från idag.

type TimeSpec = {
  matterNumber: string;
  userEmail: string;
  daysAgo: number;
  minutes: number;
  description: string;
  billable?: boolean;
};

const timeEntries: TimeSpec[] = [
  // 2026-0002 Bodelning
  { matterNumber: "2026-0002", userEmail: "anna.karlsson@ava.se", daysAgo: 55, minutes: 90, description: "Inledande klientmöte. Genomgång av tillgångar och bodelningsfrågor." },
  { matterNumber: "2026-0002", userEmail: "anna.karlsson@ava.se", daysAgo: 48, minutes: 120, description: "Upprättande av bodelningsförslag. Värdering av gemensam bostad." },
  { matterNumber: "2026-0002", userEmail: "sofia.bergstrom@ava.se", daysAgo: 45, minutes: 60, description: "Registerutdrag och handlingar från fastighetsregister." },
  { matterNumber: "2026-0002", userEmail: "anna.karlsson@ava.se", daysAgo: 32, minutes: 45, description: "Telefonmöte med motpartsombud. Diskussion om konstsamlingens värde." },
  { matterNumber: "2026-0002", userEmail: "anna.karlsson@ava.se", daysAgo: 21, minutes: 75, description: "Upprättande av skriftligt yttrande till motparten." },
  { matterNumber: "2026-0002", userEmail: "sofia.bergstrom@ava.se", daysAgo: 12, minutes: 30, description: "Korrespondens och arkivering." },

  // 2026-0003 Brottmål
  { matterNumber: "2026-0003", userEmail: "erik.lundberg@ava.se", daysAgo: 62, minutes: 75, description: "Genomläsning av förundersökning. Första kontakt med klient." },
  { matterNumber: "2026-0003", userEmail: "erik.lundberg@ava.se", daysAgo: 58, minutes: 150, description: "Klientmöte på häktet. Genomgång av åtalspunkter." },
  { matterNumber: "2026-0003", userEmail: "erik.lundberg@ava.se", daysAgo: 40, minutes: 180, description: "Upprättande av svaromål och bevisuppgift." },
  { matterNumber: "2026-0003", userEmail: "erik.lundberg@ava.se", daysAgo: 35, minutes: 45, description: "Kontakt med åklagare angående vittnesförhör." },
  { matterNumber: "2026-0003", userEmail: "sofia.bergstrom@ava.se", daysAgo: 20, minutes: 90, description: "Forskning i rättspraxis gällande misshandel ringa grad." },
  { matterNumber: "2026-0003", userEmail: "erik.lundberg@ava.se", daysAgo: 8, minutes: 60, description: "Förberedelse inför huvudförhandling." },

  // 2026-0004 Arvstvist
  { matterNumber: "2026-0004", userEmail: "anna.karlsson@ava.se", daysAgo: 90, minutes: 60, description: "Inledande rådgivning om klandertalan mot testamente." },
  { matterNumber: "2026-0004", userEmail: "anna.karlsson@ava.se", daysAgo: 75, minutes: 120, description: "Granskning av bouppteckning och testamente." },
  { matterNumber: "2026-0004", userEmail: "sofia.bergstrom@ava.se", daysAgo: 55, minutes: 75, description: "Genomgång av fastighetsvärdering och fondinnehav." },
  { matterNumber: "2026-0004", userEmail: "anna.karlsson@ava.se", daysAgo: 28, minutes: 105, description: "Upprättande av stämningsansökan mot övriga arvingar." },

  // 2026-0005 Försäkringstvist
  { matterNumber: "2026-0005", userEmail: "anna.karlsson@ava.se", daysAgo: 110, minutes: 60, description: "Första klientmöte. Genomgång av avslagsbeslut från försäkringsbolag." },
  { matterNumber: "2026-0005", userEmail: "sofia.bergstrom@ava.se", daysAgo: 95, minutes: 45, description: "Inhämtning av medicinska journaler." },
  { matterNumber: "2026-0005", userEmail: "anna.karlsson@ava.se", daysAgo: 80, minutes: 90, description: "Upprättande av omprövningsbegäran till försäkringsbolaget." },
  { matterNumber: "2026-0005", userEmail: "anna.karlsson@ava.se", daysAgo: 45, minutes: 60, description: "Telefonmöte med skaderegleraren hos Trygg-Hansa." },
  { matterNumber: "2026-0005", userEmail: "anna.karlsson@ava.se", daysAgo: 15, minutes: 120, description: "Upprättande av anmälan till Allmänna reklamationsnämnden." },
];

// ─── Utlägg ──────────────────────────────────────────────────────
// `amount` är i kronor (konverteras till öre).

type ExpenseSpec = {
  matterNumber: string;
  userEmail: string;
  daysAgo: number;
  amountSek: number;
  description: string;
  billable?: boolean;
};

const expenses: ExpenseSpec[] = [
  // 2026-0002 Bodelning
  { matterNumber: "2026-0002", userEmail: "anna.karlsson@ava.se", daysAgo: 50, amountSek: 900, description: "Ansökningsavgift tingsrätten" },
  { matterNumber: "2026-0002", userEmail: "sofia.bergstrom@ava.se", daysAgo: 44, amountSek: 385, description: "Registerutdrag och fastighetsregistret" },
  { matterNumber: "2026-0002", userEmail: "anna.karlsson@ava.se", daysAgo: 18, amountSek: 1250, description: "Värdering av konstsamling, auktoriserad värderingsman" },

  // 2026-0003 Brottmål
  { matterNumber: "2026-0003", userEmail: "erik.lundberg@ava.se", daysAgo: 57, amountSek: 450, description: "Resa till häktet, tåg + taxi" },
  { matterNumber: "2026-0003", userEmail: "erik.lundberg@ava.se", daysAgo: 40, amountSek: 215, description: "Kopiering av förundersökningsmaterial" },

  // 2026-0004 Arvstvist
  { matterNumber: "2026-0004", userEmail: "anna.karlsson@ava.se", daysAgo: 30, amountSek: 2800, description: "Ansökningsavgift tingsrätten, klandertalan" },
  { matterNumber: "2026-0004", userEmail: "sofia.bergstrom@ava.se", daysAgo: 55, amountSek: 180, description: "Registerutdrag Skatteverket" },

  // 2026-0005 Försäkringstvist
  { matterNumber: "2026-0005", userEmail: "sofia.bergstrom@ava.se", daysAgo: 94, amountSek: 320, description: "Kopior av medicinska journaler" },
  { matterNumber: "2026-0005", userEmail: "anna.karlsson@ava.se", daysAgo: 14, amountSek: 190, description: "Postporto rekommenderat brev" },
];

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  console.log("👥 Seedar team, motpartsombud, åklagare, tid och utlägg…\n");

  const org = await prisma.organization.findFirstOrThrow();

  // 1. Advokater
  console.log("⚖  Advokater och jurister…");
  const userIdByEmail = new Map<string, string>();
  for (const m of teamMembers) {
    const existing = await prisma.user.findUnique({ where: { email: m.email } });
    if (existing) {
      userIdByEmail.set(m.email, existing.id);
      console.log(`  ~ ${m.name} finns redan`);
      continue;
    }
    const passwordHash = await hash(m.password, 12);
    const created = await prisma.user.create({
      data: {
        email: m.email,
        name: m.name,
        title: m.title,
        role: m.role,
        hourlyRate: m.hourlyRate,
        mileageRate: m.mileageRate,
        passwordHash,
        organizationId: org.id,
      },
    });
    userIdByEmail.set(m.email, created.id);
    console.log(`  + ${m.name} (${m.title}, ${m.hourlyRate} kr/h) — lösenord: ${m.password}`);
  }
  console.log();

  // 2. Motpartsombud + åklagare — lägg i kontaktregistret
  console.log("📇 Motpartsombud och åklagare…");
  for (const c of externalCounsel) {
    const existing = await prisma.contact.findFirst({
      where: { name: c.name, organizationId: org.id },
    });
    if (existing) {
      console.log(`  ~ ${c.name} finns redan`);
      continue;
    }
    await prisma.contact.create({
      data: { ...c, organizationId: org.id },
    });
    console.log(`  + ${c.name} (${c.contactType})`);
  }
  console.log();

  // 3. Koppla externa parter till ärenden
  console.log("🔗 Kopplar externa parter till ärenden…");
  for (const link of counselLinks) {
    const matter = await prisma.matter.findUnique({ where: { matterNumber: link.matterNumber } });
    const contact = await prisma.contact.findFirst({
      where: { name: link.contactName, organizationId: org.id },
    });
    if (!matter || !contact) {
      console.log(`  ⚠ Saknar ärende/kontakt: ${link.matterNumber} / ${link.contactName}`);
      continue;
    }
    const existingLink = await prisma.matterContact.findFirst({
      where: { matterId: matter.id, contactId: contact.id, role: link.role },
    });
    if (existingLink) {
      console.log(`  ~ ${link.contactName} redan kopplad till ${link.matterNumber} (${link.role})`);
      continue;
    }
    await prisma.matterContact.create({
      data: { matterId: matter.id, contactId: contact.id, role: link.role },
    });
    console.log(`  + ${link.contactName} → ${link.matterNumber} (${link.role})`);
  }
  console.log();

  // 4. Tidregistreringar
  console.log("⏱  Tidregistreringar…");
  let timeCreated = 0;
  let timeSkipped = 0;
  for (const t of timeEntries) {
    const matter = await prisma.matter.findUnique({ where: { matterNumber: t.matterNumber } });
    const userId = userIdByEmail.get(t.userEmail);
    if (!matter || !userId) {
      console.log(`  ⚠ Saknar ärende/användare: ${t.matterNumber} / ${t.userEmail}`);
      continue;
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const date = new Date();
    date.setDate(date.getDate() - t.daysAgo);
    date.setHours(0, 0, 0, 0);

    // Idempotens: hoppa över om samma user+matter+date+description finns redan
    const existing = await prisma.timeEntry.findFirst({
      where: {
        userId,
        matterId: matter.id,
        date: date,
        description: t.description,
      },
    });
    if (existing) { timeSkipped++; continue; }

    await prisma.timeEntry.create({
      data: {
        userId,
        matterId: matter.id,
        date,
        minutes: t.minutes,
        description: t.description,
        hourlyRate: user.hourlyRate ?? 0,
        billable: t.billable ?? true,
      },
    });
    timeCreated++;
  }
  console.log(`  + ${timeCreated} nya, ~ ${timeSkipped} redan registrerade\n`);

  // 5. Utlägg
  console.log("💳 Utlägg…");
  let expCreated = 0;
  let expSkipped = 0;
  for (const e of expenses) {
    const matter = await prisma.matter.findUnique({ where: { matterNumber: e.matterNumber } });
    const userId = userIdByEmail.get(e.userEmail);
    if (!matter || !userId) {
      console.log(`  ⚠ Saknar ärende/användare: ${e.matterNumber} / ${e.userEmail}`);
      continue;
    }
    const date = new Date();
    date.setDate(date.getDate() - e.daysAgo);
    date.setHours(0, 0, 0, 0);

    const existing = await prisma.expense.findFirst({
      where: {
        userId,
        matterId: matter.id,
        date,
        description: e.description,
      },
    });
    if (existing) { expSkipped++; continue; }

    await prisma.expense.create({
      data: {
        userId,
        matterId: matter.id,
        date,
        amount: e.amountSek * 100, // kr → öre
        description: e.description,
        billable: e.billable ?? true,
      },
    });
    expCreated++;
  }
  console.log(`  + ${expCreated} nya, ~ ${expSkipped} redan registrerade\n`);

  // Slutsummering
  const totalUsers = await prisma.user.count({ where: { organizationId: org.id } });
  const totalContacts = await prisma.contact.count({ where: { organizationId: org.id } });
  const totalTime = await prisma.timeEntry.count({ where: { matter: { organizationId: org.id } } });
  const totalExp = await prisma.expense.count({ where: { matter: { organizationId: org.id } } });

  console.log("✅ Klart!");
  console.log(`   ${totalUsers} användare, ${totalContacts} kontakter`);
  console.log(`   ${totalTime} tidregistreringar, ${totalExp} utlägg\n`);
}

main()
  .catch((err) => {
    console.error("❌ Fel under seed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
