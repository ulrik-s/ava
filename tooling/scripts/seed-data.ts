/**
 * `seed-data` — pure data-generator för docker-firma:n.
 *
 * Exporterar:
 *   - `buildSeed()`  → in-memory dataset (typad per entitet)
 *   - `seedToFiles()` → konverterar till `{path, data}[]` via ENTITY_REGISTRY
 *
 * SOLID: separat ansvar från `seed-firma-local.ts` som äger disk + git.
 * DRY: integrationstesten + seed-scriptet använder samma data så vi inte
 * får två sourcer of truth.
 */

import {
  KOSTNADSRAKNING_TEMPLATE_NAME,
  KOSTNADSRAKNING_TEMPLATE_CATEGORY,
  KOSTNADSRAKNING_DEFAULT_HTML,
} from "@/lib/shared/kostnadsrakning-template";
import {
  ENTITY_REGISTRY,
  type ContactType,
  type InvoiceStatus,
  type MatterStatus,
  type PaymentMethod,
  type PaymentPlanStatus,
  type UserRole,
} from "@/lib/shared/schemas";

export const ORG_ID = "firma-ab";

/**
 * Options för `buildSeed()`. Default = docker-firma:n (`firma-ab` + current-user).
 * Demo-builden kör med demo-args så samma rika dataset används där.
 */
export interface BuildSeedOpts {
  /** Organisation-id som persisteras på alla entiteter. */
  orgId?: string;
  /** ID:t på den "inloggade" användaren. Defaultar till `current-user`
   *  (matchar self-hosted-bootstrap:s ensureCurrentUser). Demo använder
   *  `u-anna` för att matcha gh-pages-demon:s historiska id. */
  currentUserId?: string;
  /** Domän för seedade users-mejl + organization.email. */
  emailDomain?: string;
  /** Visningsnamn för byrån. */
  organizationName?: string;
}

/**
 * Returnera ett Date-objekt N dagar från nu, vid en given timme. Vi returnerar
 * `Date` (inte ISO-sträng) eftersom:
 *   - Smoke-testet matar datan direkt in i DemoDataStore — då måste fält som
 *     `date`/`startAt` redan vara Date (annars kraschar `isoWeek` osv.).
 *   - JSON.stringify konverterar Date → ISO-string automatiskt vid disk-skriv.
 *   - `hydrate-working-copy` revivar tillbaka ISO-strängar till Date vid läs.
 * → Konsistent representation oavsett ingång.
 */
function isoDate(daysFromNow: number, hour = 9): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, 0, 0, 0);
  return d;
}

interface UserSeed {
  id: string; email: string; name: string; role: UserRole;
  hourlyRate: number; title: string;
}

function buildUsers(currentUserId: string, emailDomain: string): UserSeed[] {
  return [
    // Alla advokater debiterar timkostnadsnormen 1 626 kr/h (162 600 öre). David
    // är biträdande jurist (ej advokat) och behåller sin lägre taxa.
    { id: currentUserId, email: `user@${emailDomain}`, name: "Anna Advokat", role: "ADMIN", hourlyRate: 162_600, title: "Senior partner" },
    { id: "u-bjorn", email: `bjorn@${emailDomain}`, name: "Björn Bauer", role: "LAWYER", hourlyRate: 162_600, title: "Advokat" },
    { id: "u-cecilia", email: `cecilia@${emailDomain}`, name: "Cecilia Carlsson", role: "LAWYER", hourlyRate: 162_600, title: "Advokat" },
    { id: "u-david", email: `david@${emailDomain}`, name: "David Dahl", role: "ASSISTANT", hourlyRate: 90_000, title: "Biträdande jurist" },
    { id: "u-eva", email: `eva@${emailDomain}`, name: "Eva Eklund", role: "LAWYER", hourlyRate: 162_600, title: "Advokat" },
  ];
}

/** Behåll legacy-export så tester som importerar `USERS` direkt fortsätter funka. */
export const USERS: UserSeed[] = buildUsers("current-user", "firma.local");

interface ContactSeed {
  id: string; name: string;
  contactType: ContactType;
  personalNumber?: string; orgNumber?: string; email?: string; phone?: string;
}

export const CONTACTS: ContactSeed[] = [
  { id: "c-andersson", name: "Anna Andersson", contactType: "PERSON", personalNumber: "19850412-1234", email: "anna@example.se", phone: "070-1112233" },
  { id: "c-bergman", name: "Björn Bergman", contactType: "PERSON", personalNumber: "19790823-5678", email: "bjorn@example.se", phone: "070-2223344" },
  { id: "c-carlsson", name: "Cecilia Carlsson", contactType: "PERSON", personalNumber: "19911105-9012", email: "cecilia@example.se", phone: "070-3334455" },
  { id: "c-davidsson", name: "David Davidsson", contactType: "PERSON", personalNumber: "19660301-3456", email: "david@example.se", phone: "070-4445566" },
  { id: "c-ek", name: "Erika Ek", contactType: "PERSON", personalNumber: "19880717-7890", email: "erika@example.se", phone: "070-5556677" },
  { id: "c-falk", name: "Fredrik Falk", contactType: "PERSON", personalNumber: "19720902-2345", email: "fredrik@example.se", phone: "070-6667788" },
  { id: "c-gustafsson", name: "Greta Gustafsson", contactType: "PERSON", personalNumber: "19951229-6789", email: "greta@example.se", phone: "070-7778899" },
  { id: "c-brf-eken", name: "BRF Eken", contactType: "COMPANY", orgNumber: "716000-1111", email: "styrelsen@brfeken.se", phone: "08-111111" },
  { id: "c-aktiebolaget-tand", name: "Aktiebolaget Tand & Trä", contactType: "COMPANY", orgNumber: "556001-2222", email: "info@tandtra.se", phone: "08-222222" },
  { id: "c-byggfirma", name: "Byggfirma Stenhammar AB", contactType: "COMPANY", orgNumber: "556002-3333", email: "kontakt@stenhammar.se", phone: "08-333333" },
  { id: "c-tingsratten-sthlm", name: "Stockholms tingsrätt", contactType: "COURT", orgNumber: "202100-2742", email: "stockholms.tingsratt@dom.se" },
  { id: "c-hovratten-svea", name: "Svea hovrätt", contactType: "COURT", orgNumber: "202100-2718", email: "svea.hovratt@dom.se" },
  { id: "c-tingsratten-gbg", name: "Göteborgs tingsrätt", contactType: "COURT", orgNumber: "202100-2734", email: "goteborgs.tingsratt@dom.se" },
  { id: "c-folksam", name: "Folksam", contactType: "INSURANCE_COMPANY", orgNumber: "502006-1619", email: "skador@folksam.se" },
  { id: "c-trygg-hansa", name: "Trygg-Hansa", contactType: "INSURANCE_COMPANY", orgNumber: "516401-7799", email: "skador@trygghansa.se" },
  { id: "c-advokatbyran-nord", name: "Advokatbyrån Nord AB", contactType: "LAW_FIRM", orgNumber: "556003-4444", email: "kontor@nord-advokat.se" },
  { id: "c-skatteverket", name: "Skatteverket", contactType: "AUTHORITY", orgNumber: "202100-5448", email: "huvudkontoret@skatteverket.se" },
];

interface MatterSeed {
  id: string; matterNumber: string; title: string;
  status: MatterStatus; matterType: string;
  paymentMethod: PaymentMethod;
  description: string;
  klientId: string; motpartId?: string; domstolId?: string;
  createdDaysAgo: number;
  isTaxeArende?: boolean;
  /** Endast för taxa-ärenden (DVFS 2025:6). */
  taxaLevel?: 1 | 2 | 3 | 4;
  taxaHuvudforhandlingMin?: number;
  taxaHasFTax?: boolean;
  /** Klientens självrisk-/kostnadsandel i bips (4000 = 40 %). */
  clientShareBips?: number;
  /** Rättshjälpens timtak (rättshjälpslagen: 100 tim). */
  rattshjalpMaxTimmar?: number;
  /** Rättsskyddets tak (öre) + lägsta självrisk (öre) ur försäkringsbeslutet (#899). */
  rattsskyddMaxOre?: number;
  rattsskyddSjalvriskMinOre?: number;
}

export const MATTERS: MatterSeed[] = [
  { id: "m-001-vardnad", matterNumber: "2026-0001", title: "Vårdnadstvist Andersson", status: "ACTIVE", matterType: "Familjerätt", paymentMethod: "RATTSHJALP", description: "Vårdnadstvist gällande gemensam dotter, 5 år.", klientId: "c-andersson", motpartId: "c-bergman", domstolId: "c-tingsratten-sthlm", createdDaysAgo: 95 },
  { id: "m-002-bostadsratt", matterNumber: "2026-0002", title: "Bostadsrätt – tvist BRF Eken", status: "ACTIVE", matterType: "Fastighetsrätt", paymentMethod: "RATTSSKYDD", description: "Tvist om underhållsansvar efter vattenskada.", klientId: "c-carlsson", motpartId: "c-brf-eken", domstolId: "c-tingsratten-sthlm", createdDaysAgo: 78 },
  { id: "m-003-arvskifte", matterNumber: "2026-0003", title: "Arvskifte Davidsson", status: "CLOSED", matterType: "Familjerätt", paymentMethod: "PRIVAT", description: "Bouppteckning och arvskifte efter avliden förälder.", klientId: "c-davidsson", createdDaysAgo: 160 },
  { id: "m-004-trafikolycka", matterNumber: "2026-0004", title: "Trafikskada Ek mot Folksam", status: "ACTIVE", matterType: "Skadestånd", paymentMethod: "RATTSSKYDD", description: "Personskada vid trafikolycka. Tvist om ersättningens storlek.", klientId: "c-ek", motpartId: "c-folksam", createdDaysAgo: 60 },
  { id: "m-005-uppsagning", matterNumber: "2026-0005", title: "Uppsägning Falk vs AB Tand & Trä", status: "ACTIVE", matterType: "Arbetsrätt", paymentMethod: "PRIVAT", description: "Felaktig uppsägning av personliga skäl.", klientId: "c-falk", motpartId: "c-aktiebolaget-tand", domstolId: "c-tingsratten-sthlm", createdDaysAgo: 42 },
  { id: "m-006-entreprenad", matterNumber: "2026-0006", title: "Entreprenadtvist Byggfirma Stenhammar", status: "ACTIVE", matterType: "Entreprenadrätt", paymentMethod: "PRIVAT", description: "Tvist om ÄTA-arbeten och slutbesiktning.", klientId: "c-gustafsson", motpartId: "c-byggfirma", domstolId: "c-tingsratten-gbg", createdDaysAgo: 50 },
  { id: "m-007-bodelning", matterNumber: "2026-0007", title: "Bodelning Bergman", status: "ACTIVE", matterType: "Familjerätt", paymentMethod: "PRIVAT", description: "Bodelning efter äktenskapsskillnad.", klientId: "c-bergman", motpartId: "c-andersson", createdDaysAgo: 30 },
  { id: "m-008-skattetvist", matterNumber: "2026-0008", title: "Skattetvist Tand & Trä AB", status: "ACTIVE", matterType: "Skatterätt", paymentMethod: "PRIVAT", description: "Överklagan av Skatteverkets omprövningsbeslut.", klientId: "c-aktiebolaget-tand", motpartId: "c-skatteverket", createdDaysAgo: 25 },
  { id: "m-009-konsumenttvist", matterNumber: "2026-0009", title: "Konsumenttvist Ek mot byggfirma", status: "CLOSED", matterType: "Konsumenträtt", paymentMethod: "RATTSSKYDD", description: "Felaktigt utförd badrumsrenovering.", klientId: "c-ek", motpartId: "c-byggfirma", createdDaysAgo: 220 },
  { id: "m-010-vardnad-2", matterNumber: "2026-0010", title: "Umgängestvist Carlsson", status: "ACTIVE", matterType: "Familjerätt", paymentMethod: "RATTSHJALP", description: "Umgänge med boförälder efter separation.", klientId: "c-carlsson", motpartId: "c-davidsson", domstolId: "c-tingsratten-sthlm", createdDaysAgo: 15, clientShareBips: 4000, rattshjalpMaxTimmar: 100 },
  { id: "m-011-overklagan", matterNumber: "2026-0011", title: "Överklagan Bergman", status: "ACTIVE", matterType: "Förvaltningsrätt", paymentMethod: "PRIVAT", description: "Överklagan av beslut från Migrationsverket.", klientId: "c-bergman", motpartId: "c-skatteverket", createdDaysAgo: 8 },
  { id: "m-012-skadestand-tha", matterNumber: "2026-0012", title: "Skadestånd Trygg-Hansa", status: "ACTIVE", matterType: "Skadestånd", paymentMethod: "RATTSSKYDD", description: "Inbrottsskada och tvist om självrisk.", klientId: "c-gustafsson", motpartId: "c-trygg-hansa", createdDaysAgo: 5 },
  { id: "m-013-hyra", matterNumber: "2025-0013", title: "Hyresvärdstvist Falk", status: "ARCHIVED", matterType: "Hyresrätt", paymentMethod: "PRIVAT", description: "Avhysning pga obetalda hyror — avgjort 2025.", klientId: "c-falk", createdDaysAgo: 400 },
  { id: "m-014-bolagsstamma", matterNumber: "2026-0014", title: "Klanderlig bolagsstämma", status: "ACTIVE", matterType: "Bolagsrätt", paymentMethod: "PRIVAT", description: "Klander av bolagsstämmobeslut i AB Tand & Trä.", klientId: "c-davidsson", motpartId: "c-aktiebolaget-tand", createdDaysAgo: 12 },
  { id: "m-015-immaterialratt", matterNumber: "2026-0015", title: "Varumärkesintrång Stenhammar", status: "ACTIVE", matterType: "Immaterialrätt", paymentMethod: "PRIVAT", description: "Påstått varumärkesintrång på \"Stenhammar\".", klientId: "c-byggfirma", createdDaysAgo: 22 },
  // Brottmål — offentlig försvarare. Brottmålstaxan tillämpas som default;
  // domstolen kan frångå taxan ifall avsevärt mer arbete krävts.
  { id: "m-016-brottmal-rh", matterNumber: "2026-0016", title: "Brottmål — rattfylleri Falk", status: "ACTIVE", matterType: "Brottmål", paymentMethod: "OFFENTLIGT_UPPDRAG", description: "Förordnad offentlig försvarare vid Stockholms tingsrätt.", klientId: "c-falk", domstolId: "c-tingsratten-sthlm", createdDaysAgo: 18, isTaxeArende: true, taxaLevel: 1, taxaHuvudforhandlingMin: 95, taxaHasFTax: true },
  { id: "m-017-brottmal-omf", matterNumber: "2026-0017", title: "Brottmål — omfattande utredning Davidsson", status: "ACTIVE", matterType: "Brottmål", paymentMethod: "OFFENTLIGT_UPPDRAG", description: "Frångångstaxa pga väsentligt mer arbete (komplex bevisning).", klientId: "c-davidsson", domstolId: "c-hovratten-svea", createdDaysAgo: 35, isTaxeArende: false },
  { id: "m-018-brottmal-ekobrott", matterNumber: "2026-0018", title: "Brottmål — ekobrott Carlsson", status: "ACTIVE", matterType: "Brottmål", paymentMethod: "OFFENTLIGT_UPPDRAG", description: "Misstanke om grovt bokföringsbrott. Omfattande material — kostnadsräkning skickas till domstol istället för enligt taxa.", klientId: "c-carlsson", domstolId: "c-tingsratten-sthlm", createdDaysAgo: 28, isTaxeArende: false },
  // Rättshjälp med TIDSVARIERANDE avgift (#878): klienten var arbetslös (5 %), fick
  // jobb (40 %) och blev arbetslös igen (5 %). Aconton ställdes ut vid de löpande
  // satserna; rättshjälpsmyndighetens SLUTLIGA helhetsbeslut blev 5 % → klienten
  // överfakturerades (särskilt via 40 %-acontot) → kreditfaktura. clientShareBips =
  // det slutliga helhetsbeslutet (5 %). Egen tidslogg (nedan) → deterministiskt arvode.
  // 2026-0021 (#899/#903): SPEGLAR Fredrik Falks vårdnadstvist (2026-0020) men här
  // BEVILJAR försäkringen rättsskydd (i st.f. rättshjälps-vägen efter avslag). Positivt
  // besked: högst 100 tim arvode, självrisk 20 % dock lägst 1 800 kr → försäkringen tar
  // merparten, klienten bara självrisken (golvet 1 800 kr slår in vid litet arbete).
  { id: "m-021-rattsskydd-positivt", matterNumber: "2026-0021", title: "Vårdnadstvist — rättsskydd beviljat Falk", status: "ACTIVE", matterType: "Familjerätt", paymentMethod: "RATTSSKYDD", description: "Speglar Fredrik Falks vårdnadstvist (jfr 2026-0020, rättshjälp) men här BEVILJAR försäkringen rättsskydd (100 tim arvode, självrisk 20 % dock lägst 1 800 kr). Större ärende som börjar nov 2025 och går över årsskiftet: löpande aconto-fakturor till klienten på självrisken (några 2025, några 2026), slutfaktura till försäkringen som PRUTAR — och då bär KLIENTEN mellanskillnaden (skillnad mot rättshjälp där byrån bär prutningen).", klientId: "c-falk", motpartId: "c-bergman", domstolId: "c-tingsratten-sthlm", createdDaysAgo: 255, clientShareBips: 2000, rattsskyddMaxOre: 16_260_000, rattsskyddSjalvriskMinOre: 180_000 },
  { id: "m-020-rattshjalp-varierande", matterNumber: "2026-0020", title: "Vårdnadstvist — varierande rättshjälp Falk", status: "ACTIVE", matterType: "Familjerätt", paymentMethod: "RATTSHJALP", description: "Rättshjälp över ett årsskifte (start nov 2025, norm 1 586 kr → 2026 norm 1 626 kr) med varierande avgift (arbetslös 5 % → anställd 40 % → arbetslös 5 %) och tidsspillan. Vid slutregleringen räknas HELA ärendet om på 2026 års norm (retroaktiv höjning) — skillnaden regleras på slutfakturorna till klient + domstol. Myndighetens slutliga avgift: 5 %.", klientId: "c-falk", motpartId: "c-bergman", domstolId: "c-tingsratten-sthlm", createdDaysAgo: 255, clientShareBips: 500, rattshjalpMaxTimmar: 100 },
];

// ASSIGN_USERS härleds inuti buildSeed() från de aktuella users — så ifall
// buildSeed:s currentUserId-opt sätts till "u-anna" hamnar det id:t här.

export interface SeedDataset {
  organizations: Record<string, unknown>[];
  offices: Record<string, unknown>[];
  users: Record<string, unknown>[];
  contacts: Record<string, unknown>[];
  matters: Record<string, unknown>[];
  matterContacts: Record<string, unknown>[];
  documents: Record<string, unknown>[];
  timeEntries: Record<string, unknown>[];
  expenses: Record<string, unknown>[];
  invoices: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  calendarEvents: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  documentTemplates: Record<string, unknown>[];
  conflictChecks: Record<string, unknown>[];
  paymentPlans: Record<string, unknown>[];
  paymentPlanReminders: Record<string, unknown>[];
  serviceNotes: Record<string, unknown>[];
}

/** Nullbara matter-fält som defaultar till null i seed-raden. */
const MATTER_NULLABLE_FIELDS: readonly (keyof MatterSeed)[] = [
  "taxaLevel", "taxaHuvudforhandlingMin", "taxaHasFTax", "clientShareBips",
  "rattshjalpMaxTimmar", "rattsskyddMaxOre", "rattsskyddSjalvriskMinOre",
];

/** MATTERS-mall → matter-rad. Nullbara fält via loop (håller komplexitet ≤8, #199). */
function toMatterRow(m: MatterSeed, orgId: string): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: m.id, organizationId: orgId, matterNumber: m.matterNumber, title: m.title,
    description: m.description, status: m.status, matterType: m.matterType,
    paymentMethod: m.paymentMethod, paymentMethodNote: null,
    paymentMethodDecidedAt: isoDate(-m.createdDaysAgo + 5),
    isTaxeArende: m.isTaxeArende ?? false,
    createdAt: isoDate(-m.createdDaysAgo),
    updatedAt: isoDate(-Math.max(1, m.createdDaysAgo - 7)),
  };
  for (const f of MATTER_NULLABLE_FIELDS) row[f] = m[f] ?? null;
  return row;
}

export function buildSeed(opts: BuildSeedOpts = {}): SeedDataset {
  const orgId = opts.orgId ?? ORG_ID;
  const currentUserId = opts.currentUserId ?? "current-user";
  const emailDomain = opts.emailDomain ?? "firma.local";
  const organizationName = opts.organizationName ?? "Firma Advokatbyrå AB";
  const users = buildUsers(currentUserId, emailDomain);
  const ASSIGN_USERS = users.map((u) => u.id);

  const out: SeedDataset = {
    organizations: [{
      id: orgId, name: organizationName, orgNumber: "556999-9999",
      email: `kontor@${emailDomain}`, phone: "08-100 100",
      address: "Storgatan 1, 111 11 Stockholm",
      accontoThresholdOre: 150_000, // 1500 kr — gränsbelopp för aconto-utskick (#885)
      createdAt: isoDate(-365), updatedAt: isoDate(-30),
    }],
    offices: [{
      id: "o-sthlm", organizationId: orgId, name: "Stockholm — huvudkontor",
      address: "Storgatan 1, 111 11 Stockholm",
      createdAt: isoDate(-365), updatedAt: isoDate(-365),
    }],
    users: users.map((u) => ({
      id: u.id, organizationId: orgId, email: u.email, name: u.name,
      title: u.title, role: u.role, hourlyRate: u.hourlyRate, mileageRate: 250,
      active: true,
      createdAt: isoDate(-200), updatedAt: isoDate(-30),
    })),
    contacts: CONTACTS.map((c) => ({
      id: c.id, organizationId: orgId, name: c.name, contactType: c.contactType,
      personalNumber: c.personalNumber ?? null, orgNumber: c.orgNumber ?? null,
      email: c.email ?? null, phone: c.phone ?? null,
      address: null, notes: null,
      createdAt: isoDate(-180), updatedAt: isoDate(-30),
    })),
    matters: MATTERS.map((m) => toMatterRow(m, orgId)),
    matterContacts: [],
    documents: [],
    timeEntries: [],
    expenses: [],
    invoices: [],
    payments: [],
    calendarEvents: [],
    tasks: [],
    documentTemplates: [],
    conflictChecks: [],
    paymentPlans: [],
    paymentPlanReminders: [],
    serviceNotes: [],
  };

  out.matterContacts = buildMatterContacts(orgId);

  out.documents = buildDocuments(orgId, users);

  out.timeEntries = buildTimeEntries(orgId, users);

  out.expenses = buildExpenses(orgId, users);

  out.invoices = buildInvoices(orgId);

  const plan = buildPaymentPlans({ orgId, currentUserId, invoices: out.invoices });
  out.payments = plan.payments;
  out.paymentPlans = plan.paymentPlans;
  out.paymentPlanReminders = plan.paymentPlanReminders;

  out.calendarEvents = buildCalendarEvents(orgId, ASSIGN_USERS);
  out.tasks = buildTasks(orgId, ASSIGN_USERS);
  out.documentTemplates = buildTemplates(orgId, currentUserId);
  out.conflictChecks = buildConflictChecks(currentUserId);
  out.serviceNotes = buildServiceNotes(orgId, ASSIGN_USERS);

  return out;
}

/** Tjänsteanteckningar (#348) — 2-3 per aktivt ärende, spridda författare/datum. */
function buildServiceNotes(orgId: string, assignUsers: string[]): SeedDataset["serviceNotes"] {
  const out: SeedDataset["serviceNotes"] = [];
  const texts = [
    "Telefonsamtal med klienten — gick igenom nästa steg och tidplan.",
    "Genomgång av motpartens svaromål; noterade två svaga punkter.",
    "Kort avstämning med domstolen om förhandlingsdatum.",
    "Klienten inkom med kompletterande underlag, diarieförde.",
    "Övervägande kring förlikningsbud — bevakar klientens instruktion.",
  ];
  const activeMatters = MATTERS.filter((m) => m.status === "ACTIVE");
  let seq = 0;
  activeMatters.forEach((matter, mi) => {
    const count = 2 + (mi % 2); // 2-3 per aktivt ärende
    for (let j = 0; j < count; j++) {
      seq++;
      const authorId = assignUsers[(mi + j) % assignUsers.length];
      const daysAgo = (seq * 2) + 1;
      const d = isoDate(-daysAgo, 9 + (j % 6));
      const pad = (n: number) => String(n).padStart(2, "0");
      out.push({
        id: `sn-${String(seq).padStart(3, "0")}`,
        organizationId: orgId,
        matterId: matter.id,
        authorId,
        date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
        text: texts[seq % texts.length],
        createdAt: d,
        updatedAt: d,
      });
    }
  });
  return out;
}

// ─── Per-entitet-byggare (utbrutna ur buildSeed för max-lines, #6) ──────────

function buildMatterContacts(orgId: string): SeedDataset["matterContacts"] {
  const out: SeedDataset["matterContacts"] = [];
  // matterContacts — klient + (motpart, motpartsombud, domstol där relevant).
  for (const m of MATTERS) {
    const created = isoDate(-m.createdDaysAgo);
    out.push({ id: `mc-${m.id}-klient`, matterId: m.id, contactId: m.klientId, role: "KLIENT", organizationId: orgId, createdAt: created });
    if (m.motpartId) {
      out.push({ id: `mc-${m.id}-motpart`, matterId: m.id, contactId: m.motpartId, role: "MOTPART", organizationId: orgId, createdAt: created });
      // Motpartsombud (advokatbyrå) — gör parts-vyn fylligare + jäv-träffar rikare.
      out.push({ id: `mc-${m.id}-ombud`, matterId: m.id, contactId: "c-advokatbyran-nord", role: "MOTPARTSOMBUD", organizationId: orgId, createdAt: created });
    }
    if (m.domstolId) out.push({ id: `mc-${m.id}-domstol`, matterId: m.id, contactId: m.domstolId, role: "DOMSTOL", organizationId: orgId, createdAt: created });
  }
  return out;
}

function buildDocuments(orgId: string, users: UserSeed[]): SeedDataset["documents"] {
  const out: SeedDataset["documents"] = [];
  // documents — 20 PDF + 20 DOCX. Faktiska binärfiler skrivs av
  // `seed-firma-local.ts` via `generateDocumentBytes()` exporterad nedan.
  const docKinds = [
    { type: "Stämningsansökan", baseName: "Stämningsansökan" },
    { type: "Svaromål", baseName: "Svaromål" },
    { type: "Bevisförteckning", baseName: "Bevisförteckning" },
    { type: "Dom", baseName: "Dom" },
    { type: "Fullmakt", baseName: "Fullmakt" },
    { type: "Avtal", baseName: "Avtal" },
    { type: "Bilaga", baseName: "Bilaga" },
    { type: "Yttrande", baseName: "Yttrande" },
  ];
  const formats: Array<{ ext: "pdf" | "docx"; mime: string; count: number }> = [
    { ext: "pdf", mime: "application/pdf", count: 20 },
    { ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", count: 20 },
  ];
  let docSeq = 0;
  for (const fmt of formats) {
    for (let i = 0; i < fmt.count; i++) {
      const matter = MATTERS[i % MATTERS.length];
      const k = docKinds[i % docKinds.length];
      const uploader = users[i % users.length];
      if (!matter || !k || !uploader) continue;
      const id = `doc-${fmt.ext}-${String(i + 1).padStart(2, "0")}`;
      const daysAgo = (docSeq * 2) + 3;
      docSeq++;
      out.push({
        id, organizationId: orgId, matterId: matter.id, folderId: null,
        fileName: `${k.baseName} ${matter.matterNumber}.${fmt.ext}`,
        mimeType: fmt.mime,
        sizeBytes: 0, // fylls i av seed-script efter att binärfilen genererats
        storagePath: `documents/content/${id}.${fmt.ext}`, version: 1,
        uploadedById: uploader.id,
        title: `${k.baseName} ${matter.matterNumber}`,
        documentType: k.type,
        summary: `${k.type} för ärende ${matter.matterNumber} — ${matter.title}. Skapat som demo-data med svenska tecken (å, ä, ö).`,
        analyzedAt: isoDate(-daysAgo + 1), analysisStatus: "DONE",
        createdAt: isoDate(-daysAgo), updatedAt: isoDate(-daysAgo + 1),
      });
    }
  }
  return out;
}

function buildTimeEntries(orgId: string, users: UserSeed[]): SeedDataset["timeEntries"] {
  const out: SeedDataset["timeEntries"] = [];
  // time entries — 4-6 per aktivt ärende (annars ser ärende-vyn tom ut).
  const tasks = ["Genomgång av handlingar", "Klientmöte", "Skrivit inlaga", "Telefon med motpart", "Förberedelse inför huvudförhandling", "Granskning av dom", "Möte med domstolen", "Korrespondens", "Förlikningsdiskussion", "Strategisk analys"];
  const activeMatters = MATTERS.filter((m) => m.status === "ACTIVE");
  let teSeq = 0;
  activeMatters.forEach((matter, mi) => {
    // Umgängestvist Carlsson (m-010) + varierande-rättshjälp (m-020) har dedikerade,
    // kronologiskt koherenta tidsloggar (rådgivningstimmen först) — se nedan (#862/#878).
    if (matter.id === "m-010-vardnad-2" || matter.id === "m-020-rattshjalp-varierande") return;
    const count = 4 + (mi % 3); // 4,5,6,4,5,6…
    for (let j = 0; j < count; j++) {
      teSeq++;
      const user = users[(mi + j) % users.length];
      if (!user) continue;
      const daysAgo = (teSeq * 2) + 1;
      out.push({
        id: `te-${String(teSeq).padStart(3, "0")}`,
        organizationId: orgId,
        userId: user.id, matterId: matter.id, date: isoDate(-daysAgo, 14),
        minutes: 30 + ((teSeq * 17) % 6) * 15,
        description: `${tasks[teSeq % tasks.length]} (${matter.title.slice(0, 30)})`,
        hourlyRate: user.hourlyRate, billable: teSeq % 8 !== 6,
        invoiceId: null, createdAt: isoDate(-daysAgo, 14), updatedAt: isoDate(-daysAgo, 14),
      });
    }
  });
  appendVardnad2TimeEntries(out, orgId, users);
  appendVaryingRattshjalpTimeEntries(out, orgId, users);
  return out;
}

/**
 * Dedikerad tidslogg för "Vårdnadstvist — varierande rättshjälp" (m-020) (#878):
 * rådgivningstimmen först, sedan arbete spritt över ~120 dagar så aconton hinner
 * ställas ut vid olika rättshjälpsavgifts-satser (arbetslös/anställd/arbetslös).
 * Totalt 10,5 tim (−1 tim rådgivning = 9,5 tim debiterbart arvode).
 */
function appendVaryingRattshjalpTimeEntries(out: SeedDataset["timeEntries"], orgId: string, users: UserSeed[]): void {
  const lawyer = users.find((u) => u.role === "LAWYER") ?? users[0];
  if (!lawyer) return;
  const rows: Array<{ daysAgo: number; minutes: number; description: string }> = [
    { daysAgo: 118, minutes: 60, description: "Första möte med klient i ärendet" }, // rådgivningstimmen — FÖRST
    { daysAgo: 100, minutes: 90, description: "Genomgång av handlingar (klient arbetslös, 5 % avgift)" },
    { daysAgo: 70, minutes: 120, description: "Förhandlingsförberedelse och inlaga" },
    { daysAgo: 55, minutes: 90, description: "Klientmöte (klient fått anställning, 40 % avgift)" },
    { daysAgo: 40, minutes: 120, description: "Sammanträde i tingsrätten" },
    { daysAgo: 20, minutes: 90, description: "Uppföljning och korrespondens (klient åter arbetslös, 5 %)" },
    { daysAgo: 8, minutes: 60, description: "Slutförberedelse inför avgörande" },
  ];
  rows.forEach((r, i) => {
    out.push({
      id: `te-m020-${i + 1}`,
      organizationId: orgId,
      userId: lawyer.id, matterId: "m-020-rattshjalp-varierande", date: isoDate(-r.daysAgo, 9),
      minutes: r.minutes, description: r.description,
      hourlyRate: lawyer.hourlyRate, billable: true,
      invoiceId: null, createdAt: isoDate(-r.daysAgo, 9), updatedAt: isoDate(-r.daysAgo, 9),
    });
  });
}

/**
 * Dedikerad tidslogg för "Umgängestvist Carlsson" (m-010, rättshjälp) (#862):
 * rådgivningstimmen ("Första möte med klient i ärendet") ligger KRONOLOGISKT
 * FÖRST (ärendets första händelse), följt av några arbetsposter — totalt ~5,75 tim
 * så ärendet får ett rimligt antal timmar. Ärendet skapades för 15 dagar sedan.
 */
function appendVardnad2TimeEntries(out: SeedDataset["timeEntries"], orgId: string, users: UserSeed[]): void {
  const lawyer = users.find((u) => u.role === "LAWYER") ?? users[0];
  if (!lawyer) return;
  const rows: Array<{ daysAgo: number; minutes: number; description: string }> = [
    { daysAgo: 14, minutes: 60, description: "Första möte med klient i ärendet" }, // rådgivningstimmen — FÖRST
    { daysAgo: 11, minutes: 60, description: "Genomgång av handlingar och underlag" },
    { daysAgo: 8, minutes: 90, description: "Upprättande av inlaga till tingsrätten" },
    { daysAgo: 4, minutes: 75, description: "Telefonkontakt med motpartens ombud" },
    { daysAgo: 2, minutes: 60, description: "Förberedelse inför sammanträde" },
  ];
  rows.forEach((r, i) => {
    out.push({
      id: `te-m010-${i + 1}`,
      organizationId: orgId,
      userId: lawyer.id, matterId: "m-010-vardnad-2", date: isoDate(-r.daysAgo, 9),
      minutes: r.minutes, description: r.description,
      hourlyRate: lawyer.hourlyRate, billable: true,
      invoiceId: null, createdAt: isoDate(-r.daysAgo, 9), updatedAt: isoDate(-r.daysAgo, 9),
    });
  });
}

function buildExpenses(orgId: string, users: UserSeed[]): SeedDataset["expenses"] {
  const out: SeedDataset["expenses"] = [];
  // expenses
  // Moms-modellen följer Skatteverket: persontransporter 6 %, restaurang 12 %,
  // myndighetsavgifter 0 %, övrigt 25 %. `amount` nedan är kvitto-beloppet inkl
  // moms — lagras dock NETTO (exkl moms) per #782; AVA lägger på momsen.
  const cats: Array<{ amount: number; description: string; vatRate: number }> = [
    { amount: 12500, description: "Domstolsavgift", vatRate: 0 },         // momsfritt
    { amount: 4500, description: "Tåg Stockholm-Göteborg", vatRate: 600 }, // 6 % persontransport
    { amount: 1850, description: "Taxi domstol", vatRate: 600 },           // 6 %
    { amount: 28000, description: "Översättningskostnad", vatRate: 2500 }, // 25 %
    { amount: 9900, description: "Kopiering vittnesmaterial", vatRate: 2500 },
    { amount: 6200, description: "Lunch klientmöte", vatRate: 1200 },      // 12 % restaurang
    { amount: 3200, description: "Parkeringsavgift", vatRate: 2500 },
    { amount: 15000, description: "Expertutlåtande", vatRate: 2500 },
  ];
  let exSeq = 0;
  const activeMatters = MATTERS.filter((m) => m.status === "ACTIVE");
  activeMatters.forEach((matter, mi) => {
    const count = 2 + (mi % 2); // 2-3 per aktivt ärende
    for (let j = 0; j < count; j++) {
      exSeq++;
      const user = users[(mi + j) % users.length];
      const cat = cats[exSeq % cats.length];
      if (!user || !cat) continue;
      const daysAgo = (exSeq * 3) + 2;
      // Lagra netto: härled exkl-moms ur kvittots inkl-belopp (#782).
      const netAmount = cat.vatRate === 0 ? cat.amount : Math.round((cat.amount * 10000) / (10000 + cat.vatRate));
      out.push({
        id: `ex-${String(exSeq).padStart(3, "0")}`,
        organizationId: orgId,
        userId: user.id, matterId: matter.id, date: isoDate(-daysAgo, 12),
        amount: netAmount, description: cat.description,
        vatRate: cat.vatRate, vatIncluded: false,
        billable: true, invoiceId: null,
        createdAt: isoDate(-daysAgo, 12), updatedAt: isoDate(-daysAgo, 12),
      });
    }
  });
  return out;
}

function buildInvoices(orgId: string): SeedDataset["invoices"] {
  const out: SeedDataset["invoices"] = [];
  // invoices
  const statuses: InvoiceStatus[] = ["DRAFT", "SENT", "PAID", "INSTALLMENT_PLAN"];
  for (let i = 0; i < 12; i++) {
    const matter = MATTERS[i % MATTERS.length];
    if (!matter) continue;
    const daysAgo = (i * 7) + 5;
    const amountInclVat = 80_000 + (i * 23_000);
    // 25 % moms baked-in: exklusiv-belopp = inkl / 1.25 (avrundat till örestal)
    const amountExclVat = Math.round(amountInclVat / 1.25);
    const status = statuses[i % statuses.length];
    const issuedAt = isoDate(-daysAgo);
    const dueAt = isoDate(-daysAgo + 30);
    const paidAt = status === "PAID" ? isoDate(-daysAgo + 20) : null;
    out.push({
      id: `inv-${String(i + 1).padStart(3, "0")}`,
      organizationId: orgId,
      matterId: matter.id,
      invoiceNumber: `${new Date().getFullYear()}-${String(i + 1).padStart(4, "0")}`,
      // `invoiceType` är kanoniskt. Legacy-aliaset `type` skrivs inte längre
      // (borttaget i schemaVersion 2 — migrate-on-read strippar det ur äldre
      // repon vid hydrering, ADR 0004).
      invoiceType: "STANDARD",
      status,
      // Båda fältnamnen — UI använder gamla `amount`/`invoiceDate`/`dueDate`,
      // projection-hydratorn använder amountInclVat/issuedAt/dueAt/paidAt.
      amountExclVat,
      vat: amountInclVat - amountExclVat,
      amountInclVat,
      amount: amountInclVat,
      issuedAt,
      invoiceDate: issuedAt,
      dueAt,
      dueDate: dueAt,
      paidAt,
      notes: null,
      createdAt: issuedAt,
      updatedAt: issuedAt,
    });
  }
  return out;
}

interface PlanBundle {
  paymentPlans: SeedDataset["paymentPlans"];
  paymentPlanReminders: SeedDataset["paymentPlanReminders"];
  payments: SeedDataset["payments"];
}

// Payment plans — vi vill att data:n känns levande:
//   • 5 ACTIVE planer i olika faser (precis startad, mitt i, nästan klar)
//   • 1 COMPLETED plan (alla månadsbetalningar finns som payments)
//   • 1 CANCELLED plan (avbruten utan inbetalningar)
// INVARIANT: varje INSTALLMENT_PLAN-faktura MÅSTE ha en motsvarande ACTIVE-plan.
// buildPaymentPlans patchar fakturornas status så det stämmer.
interface PlanTarget {
  invoiceId: string;
  status: PaymentPlanStatus;
  monthlyAmount: number;
  dayOfMonth: number;
  startsDaysAgo: number;
  /** Hur många månads-inbetalningar som redan kommit in. */
  paymentsMade: number;
  /** Senaste-månader reminders. */
  withReminders: boolean;
}
const PLAN_TARGETS: PlanTarget[] = [
  { invoiceId: "inv-001", status: "ACTIVE", monthlyAmount: 20_000, dayOfMonth: 15, startsDaysAgo: 30, paymentsMade: 1, withReminders: true },
  { invoiceId: "inv-004", status: "ACTIVE", monthlyAmount: 25_000, dayOfMonth: 15, startsDaysAgo: 90, paymentsMade: 3, withReminders: true },
  { invoiceId: "inv-005", status: "ACTIVE", monthlyAmount: 15_000, dayOfMonth: 1, startsDaysAgo: 120, paymentsMade: 4, withReminders: true },
  { invoiceId: "inv-009", status: "ACTIVE", monthlyAmount: 35_000, dayOfMonth: 25, startsDaysAgo: 60, paymentsMade: 2, withReminders: true },
  { invoiceId: "inv-010", status: "ACTIVE", monthlyAmount: 22_000, dayOfMonth: 10, startsDaysAgo: 45, paymentsMade: 1, withReminders: false },
  { invoiceId: "inv-008", status: "COMPLETED", monthlyAmount: 18_000, dayOfMonth: 1, startsDaysAgo: 365, paymentsMade: 6, withReminders: true },
  { invoiceId: "inv-012", status: "CANCELLED", monthlyAmount: 30_000, dayOfMonth: 28, startsDaysAgo: 60, paymentsMade: 0, withReminders: false },
];

/** Reminders för en plan (aktiva: senaste 2 mån; completed: hela historiken). */
function planReminders(p: PlanTarget, planId: string): SeedDataset["paymentPlanReminders"] {
  const out: SeedDataset["paymentPlanReminders"] = [];
  if (!p.withReminders) return out;
  const monthsBack = p.status === "COMPLETED" ? 6 : Math.min(2, p.paymentsMade + 1);
  for (let m = monthsBack; m >= 1; m--) {
    const due = new Date();
    due.setMonth(due.getMonth() - m);
    const dueMonth = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}`;
    out.push({
      id: `ppr-${planId}-${dueMonth}-DUE`,
      planId, dueMonth, type: "DUE",
      sentAt: new Date(due.getFullYear(), due.getMonth(), p.dayOfMonth - 5),
    });
  }
  return out;
}

/** Invoice-status som matchar planens livscykel. */
function invoiceStatusForPlan(planStatus: PlanTarget["status"]): InvoiceStatus {
  if (planStatus === "ACTIVE") return "INSTALLMENT_PLAN";
  if (planStatus === "COMPLETED") return "PAID";
  return "SENT";
}

/** Full betalning mot VARJE vanlig PAID-faktura (utan plan) så att en PAID-
 *  status alltid är ledger-koherent (#350: ingen PAID utan täckande betalning).
 *  Numreras från `startSeq`. */
function extraPayments(invoices: SeedDataset["invoices"], startSeq: number, currentUserId: string): SeedDataset["payments"] {
  const out: SeedDataset["payments"] = [];
  const paidExtras = invoices.filter((x) => {
    const r = x as { status: string; id: string };
    return r.status === "PAID" && !PLAN_TARGETS.some((p) => p.invoiceId === r.id);
  });
  let seq = startSeq;
  for (const inv of paidExtras) {
    const r = inv as { id: string; amountInclVat: number; issuedAt: Date | string };
    seq++;
    const issuedIso = typeof r.issuedAt === "string" ? r.issuedAt : r.issuedAt.toISOString();
    out.push({
      id: `pay-${String(seq).padStart(3, "0")}`,
      invoiceId: r.id, amount: r.amountInclVat, paidAt: new Date(issuedIso),
      note: "Engångsbetalning", recordedById: currentUserId, createdAt: new Date(issuedIso),
    });
  }
  return out;
}

function buildPaymentPlans({ currentUserId, invoices }: {
  orgId: string; currentUserId: string; invoices: SeedDataset["invoices"];
}): PlanBundle {
  const paymentPlans: SeedDataset["paymentPlans"] = [];
  const paymentPlanReminders: SeedDataset["paymentPlanReminders"] = [];
  const payments: SeedDataset["payments"] = [];

  let paymentSeq = 0;
  for (let i = 0; i < PLAN_TARGETS.length; i++) {
    const p = PLAN_TARGETS[i];
    if (!p) continue;
    const planId = `pp-${String(i + 1).padStart(3, "0")}`;
    paymentPlans.push({
      id: planId, invoiceId: p.invoiceId, monthlyAmount: p.monthlyAmount,
      dayOfMonth: p.dayOfMonth, startDate: isoDate(-p.startsDaysAgo), status: p.status,
      notes: p.status === "CANCELLED" ? "Avbruten på klientens begäran" : null,
      createdAt: isoDate(-p.startsDaysAgo - 1), updatedAt: isoDate(-1),
    });
    paymentPlanReminders.push(...planReminders(p, planId));

    // Patcha invoice-statusen så den matchar planen.
    const inv = invoices.find((x) => (x as { id: string }).id === p.invoiceId) as Record<string, unknown> | undefined;
    if (inv) inv.status = invoiceStatusForPlan(p.status);

    const rows = planPaymentRows(p, inv, paymentSeq, currentUserId);
    payments.push(...rows);
    paymentSeq += rows.length;
  }

  payments.push(...extraPayments(invoices, paymentSeq, currentUserId));
  return { paymentPlans, paymentPlanReminders, payments };
}

/** Payment-rader för en plan: en per "inkommen" månad + (för COMPLETED) en
 *  slutbetalning som täcker resten av fakturan (#350: PAID ⇒ ledger-koherent). */
function planPaymentRows(
  p: PlanTarget, inv: Record<string, unknown> | undefined, startSeq: number, currentUserId: string,
): SeedDataset["payments"] {
  const rows: SeedDataset["payments"] = [];
  let seq = startSeq;
  for (let m = p.paymentsMade; m >= 1; m--) {
    const due = new Date();
    due.setMonth(due.getMonth() - m + 1);
    due.setDate(p.dayOfMonth);
    seq++;
    rows.push({
      id: `pay-${String(seq).padStart(3, "0")}`,
      invoiceId: p.invoiceId, amount: p.monthlyAmount, paidAt: due,
      note: `Månadsbetalning ${m} av planen`, recordedById: currentUserId, createdAt: due,
    });
  }
  const remainder = inv ? Number(inv.amountInclVat ?? inv.amount ?? 0) - p.paymentsMade * p.monthlyAmount : 0;
  if (p.status === "COMPLETED" && remainder > 0) {
    const due = new Date();
    due.setDate(p.dayOfMonth);
    seq++;
    rows.push({
      id: `pay-${String(seq).padStart(3, "0")}`,
      invoiceId: p.invoiceId, amount: remainder, paidAt: due,
      note: "Slutbetalning (planen fullföljd)", recordedById: currentUserId, createdAt: due,
    });
  }
  return rows;
}

function buildCalendarEvents(orgId: string, ASSIGN_USERS: string[]): SeedDataset["calendarEvents"] {
  const out: SeedDataset["calendarEvents"] = [];
  // calendar events
  const tpl: Array<{ kind: "appointment" | "deadline"; title: string; location?: string; hoursLong: number }> = [
    { kind: "appointment", title: "Klientmöte", location: "Kontoret", hoursLong: 1 },
    { kind: "appointment", title: "Huvudförhandling", location: "Stockholms tingsrätt, sal 3", hoursLong: 6 },
    { kind: "appointment", title: "Förberedande sammanträde", location: "Stockholms tingsrätt, sal 7", hoursLong: 2 },
    { kind: "deadline", title: "Inlaga inlämnas", hoursLong: 0 },
    { kind: "deadline", title: "Bevisuppgift", hoursLong: 0 },
    { kind: "appointment", title: "Förlikningsmöte", location: "Motpartens kontor", hoursLong: 3 },
    { kind: "deadline", title: "Överklagan sista dag", hoursLong: 0 },
    { kind: "appointment", title: "Intern teammöte", location: "Konferensrum", hoursLong: 1 },
  ];
  // Fördela events över ALLA användare — annars känns multi-user-vyn
  // tom när användaren togglar in en annan kollega. Bumpat antal så
  // varje user får minst 3 events i ett nära tidsfönster.
  for (let i = 0; i < 25; i++) {
    const t = tpl[i % tpl.length];
    const matter = MATTERS[i % MATTERS.length];
    const userId = ASSIGN_USERS[i % ASSIGN_USERS.length];
    if (!t || !matter) continue;
    const daysOffset = (i % 14) - 5; // -5..+8 dagar runt idag
    const start = isoDate(daysOffset, 9 + (i % 4) * 2);
    const endAt = t.hoursLong > 0 ? new Date(start.getTime() + t.hoursLong * 3600_000) : null;
    out.push({
      id: `cal-${String(i + 1).padStart(3, "0")}`,
      userId, organizationId: orgId, kind: t.kind,
      title: `${t.title} — ${matter.matterNumber}`, description: null,
      location: t.location ?? null, startAt: start, endAt,
      allDay: t.kind === "deadline", matterId: matter.id, visibility: "normal",
      mirrorToOutlook: false, createdAt: isoDate(-30), updatedAt: isoDate(-30),
    });
  }

  return out;
}

function buildTasks(orgId: string, ASSIGN_USERS: string[]): SeedDataset["tasks"] {
  const out: SeedDataset["tasks"] = [];
  // tasks — sprid 80 stycken över förfluten + framtid, alla användare,
  // alla ärenden, mix av status/prioritet. Ger realistisk volym till
  // dashboard-widgeten och /todo-vyn.
  const taskTitles = [
    "Skriv inlaga till tingsrätten", "Granska motpartens svaromål",
    "Beställ vittnesinkallelser", "Boka tolk till huvudförhandling",
    "Förbereda korsförhör", "Skicka faktura efter förlikning",
    "Uppdatera ärendebeskrivning", "Ring klient angående status",
    "Kopiera handlingar till motparten", "Boka mötesrum för klientmöte",
    "Skicka in fullmakt", "Sammanställ bevisuppgift",
    "Förbered slutplädering", "Skicka påminnelse om obetald faktura",
    "Kontakta domstolen om förhandlingsdatum", "Begär ut handlingar från myndighet",
    "Skicka över förslag till förlikning", "Förbered avtalsmall",
    "Boka medling", "Genomgång av nytt material",
    "Hör med vittne om tillgänglighet", "Lägg in tidrapport för förra veckan",
    "Korrekturläsning av dom", "Skicka kvitto till klient",
    "Förbereda agenda för möte", "Uppdatera klient om ärendets status",
    "Skicka in överklagan", "Granska sakkunnigutlåtande",
    "Förbered budget för ärendet", "Skriva sammanfattning till klient",
  ];
  const priorities: Array<"LOW" | "MEDIUM" | "HIGH"> = ["LOW", "MEDIUM", "HIGH"];
  // Vikt mot TODO (oavslutade dominerar i en advokatbyrå).
  const taskStatusPool: Array<"TODO" | "IN_PROGRESS" | "DONE"> = [
    "TODO", "TODO", "TODO", "TODO", "IN_PROGRESS", "IN_PROGRESS", "DONE", "DONE",
  ];
  // Generera per användare så var och en garanterat får tasks vid offset=0
  // (idag) — annars gör gcd-fall att vissa users hamnar utanför "idag".
  const userTaskOffsets = [-14, -10, -7, -4, -2, -1, 0, 0, 1, 2, 3, 5, 7, 10, 14, 21];
  let taskSeq = 0;
  for (const uid of ASSIGN_USERS) {
    for (let j = 0; j < userTaskOffsets.length; j++) {
      const matter = MATTERS[taskSeq % MATTERS.length];
      const status = taskStatusPool[taskSeq % taskStatusPool.length];
      const dueOffset = userTaskOffsets[j];
      if (!matter || dueOffset === undefined || !status) continue;
      out.push(makeTaskRow({
        taskSeq, uid, orgId, j, matter, status, dueOffset,
        title: taskTitles[taskSeq % taskTitles.length]!,
        priority: priorities[taskSeq % priorities.length]!,
      }));
      taskSeq++;
    }
  }

  return out;
}

/** Bygger en enskild task-rad ur loop-index + utvald matter/status/prioritet. */
function makeTaskRow(args: {
  taskSeq: number; uid: string; orgId: string; j: number;
  matter: MatterSeed; title: string; status: "TODO" | "IN_PROGRESS" | "DONE";
  priority: "LOW" | "MEDIUM" | "HIGH"; dueOffset: number;
}): SeedDataset["tasks"][number] {
  const { taskSeq, uid, orgId, j, matter, title, status, priority, dueOffset } = args;
  const dueAt = isoDate(dueOffset, [9, 11, 14, 16][j % 4] ?? 9);
  dueAt.setMinutes([0, 15, 30, 45][j % 4] ?? 0);
  const createdOffset = -((taskSeq * 3) % 30 + 1);
  return {
    id: `task-${String(taskSeq + 1).padStart(3, "0")}`,
    userId: uid,
    organizationId: orgId,
    title,
    description: taskSeq % 3 === 0 ? `Uppgift kopplad till ärende ${matter.title}.` : null,
    status,
    priority,
    dueAt,
    completedAt: status === "DONE" ? isoDate(dueOffset - 1) : null,
    matterId: matter.id,
    createdAt: isoDate(createdOffset),
    updatedAt: isoDate(Math.max(-1, createdOffset + 2)),
  };
}

function buildTemplates(orgId: string, currentUserId: string): SeedDataset["documentTemplates"] {
  const out: SeedDataset["documentTemplates"] = [];
  // templates
  const templates = [
    { id: "tpl-fullmakt", name: "Fullmakt", category: "Allmänt", body: "<h1>Fullmakt</h1><p>{{contact.name}} ger härmed {{user.name}} rätt att företräda mig i ärende {{matter.matterNumber}}.</p>" },
    { id: "tpl-stamning", name: "Stämningsansökan", category: "Tvist", body: "<h1>Stämningsansökan</h1><p>Mål nr: {{matter.matterNumber}}</p>" },
    { id: "tpl-avtal", name: "Avtal", category: "Avtal", body: "<h1>Avtal</h1>" },
    { id: "tpl-forlikning", name: "Förlikningsavtal", category: "Tvist", body: "<h1>Förlikningsavtal</h1>" },
    { id: "tpl-besvarsskrivelse", name: "Besvärsskrivelse", category: "Förvaltning", body: "<h1>Överklagan</h1>" },
    { id: "tpl-kostnadsrakning", name: KOSTNADSRAKNING_TEMPLATE_NAME, category: KOSTNADSRAKNING_TEMPLATE_CATEGORY, body: KOSTNADSRAKNING_DEFAULT_HTML },
  ];
  for (const t of templates) {
    out.push({
      id: t.id, organizationId: orgId, name: t.name,
      description: `Standardmall för ${t.name.toLowerCase()}.`,
      category: t.category, content: t.body, createdById: currentUserId,
      createdAt: isoDate(-90), updatedAt: isoDate(-30),
    });
  }

  return out;
}

function buildConflictChecks(currentUserId: string): SeedDataset["conflictChecks"] {
  const out: SeedDataset["conflictChecks"] = [];
  // conflict checks
  const cc = [
    { id: "cc-01", searchTerm: "Andersson", searchType: "name" as const },
    { id: "cc-02", searchTerm: "19850412-1234", searchType: "personalNumber" as const },
    { id: "cc-03", searchTerm: "Eriksson", searchType: "name" as const },
    { id: "cc-04", searchTerm: "BRF Eken", searchType: "name" as const },
    { id: "cc-05", searchTerm: "Folksam", searchType: "name" as const },
  ];
  for (let i = 0; i < cc.length; i++) {
    const c = cc[i];
    if (!c) continue;
    out.push({
      id: c.id, searchTerm: c.searchTerm, searchType: c.searchType,
      results: [], checkedById: currentUserId, createdAt: isoDate(-(i * 3 + 1)),
    });
  }

  return out;
}

/**
 * Generera binärfil-bytes för ett seed-dokument. Stödjer PDF + DOCX.
 *
 * - PDF: enkelsidig, brödtext via pdf-lib. Bäddar in en Type-1-font från
 *   pdf-lib (StandardFonts.Helvetica) som täcker latin-1 inklusive svenska
 *   tecken via WinAnsi-encoding (å=0xE5, ä=0xE4, ö=0xF6).
 * - DOCX: html-to-docx tar HTML och returnerar en Buffer med en giltig
 *   docx-zip. HTML innehåller å/ä/ö → encoder hanterar UTF-8 inom XML.
 *
 * Returnerar `Uint8Array` så callern enkelt kan skriva via `writeFileSync`.
 */
// eslint-disable-next-line complexity
export async function generateDocumentBytes(doc: {
  id: string;
  title?: string;
  fileName?: string;
  documentType?: string;
  summary?: string;
  mimeType?: string;
  storagePath?: string;
}): Promise<Uint8Array> {
  const title = doc.title ?? doc.fileName ?? doc.id;
  const heading = doc.documentType ?? "Dokument";
  const body = doc.summary
    ?? "Detta är ett demo-dokument med svenska tecken: å, ä, ö, Å, Ä, Ö.";
  const ext = doc.storagePath?.toLowerCase().endsWith(".pdf") ? "pdf"
    : doc.storagePath?.toLowerCase().endsWith(".docx") ? "docx"
    : doc.mimeType?.includes("pdf") ? "pdf" : "docx";

  if (ext === "pdf") {
    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    pdf.setTitle(title);
    pdf.setAuthor("AVA Seed");
    pdf.setSubject(heading);
    const page = pdf.addPage([595, 842]); // A4
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    page.drawText(title, { x: 50, y: 780, size: 18, font: bold, color: rgb(0, 0, 0) });
    page.drawText(heading, { x: 50, y: 750, size: 12, font: bold, color: rgb(0.3, 0.3, 0.3) });
    // Brödtext med ordbrytning (manuell — pdf-lib har inget auto-wrap)
    const lines = wrapText(body, 80);
    let y = 710;
    for (const line of lines) {
      page.drawText(line, { x: 50, y, size: 11, font });
      y -= 16;
    }
    return pdf.save();
  }

  // DOCX via html-to-docx. Paketet skeppar inga typings (otypat 3rd-party,
  // endast build-time). Vi typar destruktureringen explicit (ingen `any`, ingen
  // cast) och låter ETT smalt @ts-expect-error svälja TS7016 på importen — en
  // ambient `declare module` skuggas under moduleResolution:bundler och en
  // tsconfig-`paths` skulle bryta runtime-resolven (bun följer paths).
  type HtmlToDocx = (
    html: string,
    headerHtml?: string | null,
    options?: { table?: { row?: { cantSplit?: boolean } } } & Record<string, unknown>,
  ) => Promise<Buffer>;
  // @ts-expect-error — html-to-docx saknar .d.ts; default-exporten är callable.
  const { default: htmlToDocx }: { default: HtmlToDocx } = await import("html-to-docx");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeXml(title)}</title></head>` +
    `<body><h1>${escapeXml(title)}</h1><h2>${escapeXml(heading)}</h2><p>${escapeXml(body)}</p></body></html>`;
  const buf = await htmlToDocx(html, undefined, { table: { row: { cantSplit: true } } });
  // html-to-docx returnerar Buffer i Node. Buffer extends Uint8Array men
  // TS-typerna är inte 1:1 — kopiera bytes över en ny Uint8Array.
  return Uint8Array.from(buf);
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = (cur ? cur + " " : "") + w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => (
    c === "<" ? "&lt;" :
    c === ">" ? "&gt;" :
    c === "&" ? "&amp;" :
    c === '"' ? "&quot;" : "&apos;"
  ));
}

/**
 * Konvertera dataset till `{ path, data }[]` via `ENTITY_REGISTRY.gitPath()`.
 * Single source of truth för path-konventionen.
 */
export function seedToFiles(dataset: SeedDataset): Array<{ path: string; data: Record<string, unknown> }> {
  const entityKeys: Array<[keyof SeedDataset, string]> = [
    ["organizations", "organization"],
    ["offices", "office"],
    ["users", "user"],
    ["contacts", "contact"],
    ["matters", "matter"],
    ["matterContacts", "matterContact"],
    ["documents", "document"],
    ["timeEntries", "timeEntry"],
    ["expenses", "expense"],
    ["invoices", "invoice"],
    ["payments", "payment"],
    ["calendarEvents", "calendarEvent"],
    ["tasks", "task"],
    ["documentTemplates", "documentTemplate"],
    ["conflictChecks", "conflictCheck"],
    ["paymentPlans", "paymentPlan"],
    ["paymentPlanReminders", "paymentPlanReminder"],
  ];
  const out: Array<{ path: string; data: Record<string, unknown> }> = [];
  for (const [key, entityName] of entityKeys) {
    const entry = ENTITY_REGISTRY[entityName];
    if (!entry) continue;
    for (const row of dataset[key]) {
      const data = row as Record<string, unknown>;
      const path = entry.gitPath(data.id as string, data);
      out.push({ path, data });
    }
  }
  return out;
}
