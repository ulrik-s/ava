/**
 * Radvägens policy per entitet (#1344) — vad en klient får skriva som färdig rad.
 *
 * Radkön skriver raden som klienten skickar, utan routrarnas regler. Därför
 * nekas allt som standard: bara entiteterna i `ROW_PUSH_POLICY` tas emot, och
 * för dem prövas
 *   - referenser (`refs`): en satt referens (ärende, kontakt, dokument,
 *     användare …) får inte peka på en annan byrås rad;
 *   - vem som gjorde ändringen (`actor`): en ny rad måste bära den pushande
 *     användaren (en anteckning kan inte skrivas i en kollegas namn), och fältet
 *     kan inte ändras efteråt;
 *   - ägaren (`owner`): en användares egna rader (preferenserna) kan bara
 *     den användaren skriva;
 *   - loggar (`appendOnly`): jävskontrollens logg kan bara läggas till;
 *   - sökvägen till innehållet (`contentPath`, #1372): rätt form och
 *     dokumentets eget innehåll (`document-storage-path.ts`) när den sätts
 *     eller ändras;
 *   - samma ärende (`sameMatter`, #2044): en refererad rad ligger i radens
 *     ärende, när referensen eller radens ärende sätts eller ändras;
 *   - låsta fält (`lockedWhen`, #2044): fälten ändras inte när en vakt är satt
 *     på serverns rad (fakturans och kostnadsräkningens egna dokument).
 *
 * Användare, byrån, kontor, byråns standardvyer och mallar tas inte emot här:
 * de är procedurägda (`procedure-owned.ts`) och skrivs bara genom att servern
 * kör om routern — där gäller rollen (admin) och vilka fält som får ändras.
 */

import { isDocumentStoragePath, isOwnStoragePath } from "@/lib/shared/document-storage-path";
import type { OrganizationId, UserId } from "@/lib/shared/schemas/ids";
import { isUuid } from "@/lib/shared/uuid";

type Row = Record<string, unknown>;

/** Den som pushar: server-verifierad byrå och användare (aldrig ur raden). */
export interface RowPusher {
  readonly organizationId: OrganizationId;
  readonly userId: UserId;
}

/** Hur en entitet får skrivas via radkön. */
interface RowPolicy {
  /** Referensfält → entiteten fältet pekar på. */
  readonly refs?: Readonly<Record<string, string>>;
  /** Fältet som anger vem som skapade raden. */
  readonly actor?: string;
  /** Fältet som anger vems raden är — bara den användaren skriver den. */
  readonly owner?: string;
  /** Raden kan bara skapas, aldrig ändras eller tas bort. */
  readonly appendOnly?: true;
  /** Fältet med sökvägen till radens innehåll i content-store:n. */
  readonly contentPath?: string;
  /**
   * Referensfält → entitet (#2044): den refererade raden ska ha samma
   * `matterId` som raden. Prövas mot den sammanslagna raden när referensen
   * eller radens `matterId` sätts eller ändras. En tom referens och en rad som
   * inte finns prövas inte (som `refs`).
   */
  readonly sameMatter?: Readonly<Record<string, string>>;
  /**
   * Låsta fält (#2044): `fields` får inte ändras när någon av `guards` är satt
   * på serverns rad. Ett fält som inte skickas, eller skickas med samma värde
   * som servern har, räknas som oförändrat.
   */
  readonly lockedWhen?: { readonly fields: readonly string[]; readonly guards: readonly string[] };
}

const USER = "user";
const MATTER = "matter";
const DOCUMENT = "document";

/** Entiteterna radkön tar emot. Allt annat avvisas (neka som standard). */
export const ROW_PUSH_POLICY: Readonly<Record<string, RowPolicy>> = Object.freeze({
  contact: { refs: { parentId: "contact" } },
  task: { refs: { userId: USER, matterId: MATTER } },
  calendarEvent: { refs: { userId: USER, matterId: MATTER } },
  document: {
    refs: { matterId: MATTER, folderId: "documentFolder", invoiceId: "invoice", billingRunId: "billingRun" },
    actor: "uploadedById",
    contentPath: "storagePath",
    sameMatter: { folderId: "documentFolder" },
    // Vakterna står också bland fälten: en klient kan inte först nolla dem och sedan byta ärende.
    lockedWhen: { fields: ["matterId", "invoiceId", "billingRunId"], guards: ["invoiceId", "billingRunId"] },
  },
  documentFolder: { refs: { matterId: MATTER, parentId: "documentFolder" } },
  documentPart: { refs: { matterId: MATTER, documentId: DOCUMENT }, sameMatter: { documentId: DOCUMENT } },
  documentAnalysisSuggestion: { refs: { documentId: DOCUMENT, acceptedContactId: "contact" } },
  matterEventSuggestion: { refs: { documentId: DOCUMENT } },
  serviceNote: { refs: { matterId: MATTER }, actor: "authorId" },
  userPreference: { owner: "userId" },
  conflictCheck: { refs: { matterId: MATTER }, actor: "checkedById", appendOnly: true },
});

/** Beskeden när policyn avvisar en rad. */
export const ROW_POLICY_REASONS = {
  denied: "Servern tar inte emot den här ändringen som rad. Gör om den i appen.",
  appendOnly: "Raden kan inte ändras eller tas bort i efterhand.",
  owner: "Raden tillhör en annan användare.",
  actor: "Raden måste skapas i ditt eget namn.",
  badRef: "ogiltig referens",
  otherOrg: "annan byrå",
  contentPath: "Sökvägen till dokumentets innehåll är ogiltig.",
  otherMatter: "annat ärende",
  locked: "Raden hör till en faktura eller kostnadsräkning och kan inte byta ärende.",
} as const;

/** En avvisning från policyn. */
export interface RowPolicyRejection {
  reason: (typeof ROW_POLICY_REASONS)[keyof typeof ROW_POLICY_REASONS];
}

/**
 * Byrån en refererad rad hör till: `null` om raden inte finns (ingen läcka
 * att stoppa), `undefined` om den finns men byrån inte går att avgöra.
 */
export type RefOrg = (entity: string, id: string) => Promise<string | null | undefined>;

/**
 * Ärendet en refererad rad ligger i (#2044), läst i samma transaktion som
 * pushen: `null` om raden inte finns, `undefined` om den saknar ärende.
 */
export type RefMatter = (entity: string, id: string) => Promise<string | null | undefined>;

/** Det policyn prövar: vad som skickades, vad servern har och vem som pushar. */
export interface PolicyInput {
  readonly entity: string;
  readonly kind: "create" | "update" | "delete";
  readonly incoming: Row | null;
  readonly existing: Row | null;
  readonly pusher: RowPusher;
  readonly refOrg: RefOrg;
  readonly refMatter: RefMatter;
}

/** Entitetens policy (egna nycklar — inte `__proto__` o.d.). */
function policyOf(entity: string): RowPolicy | undefined {
  return Object.hasOwn(ROW_PUSH_POLICY, entity) ? ROW_PUSH_POLICY[entity] : undefined;
}

function reject(reason: RowPolicyRejection["reason"]): RowPolicyRejection {
  return { reason };
}

/** Raden som blir resultatet: serverns rad med klientens fält ovanpå. */
function merged(input: PolicyInput): Row | null {
  return input.incoming ? { ...(input.existing ?? {}), ...input.incoming } : null;
}

function checkAppendOnly(policy: RowPolicy, kind: PolicyInput["kind"]): RowPolicyRejection | null {
  return policy.appendOnly && kind !== "create" ? reject(ROW_POLICY_REASONS.appendOnly) : null;
}

/** Ägaren: både den befintliga raden och resultatet måste vara den pushandes. */
function checkOwner(policy: RowPolicy, input: PolicyInput): RowPolicyRejection | null {
  const field = policy.owner;
  if (!field) return null;
  const rows = [input.existing, merged(input)].filter((r): r is Row => r !== null);
  return rows.every((r) => r[field] === input.pusher.userId) ? null : reject(ROW_POLICY_REASONS.owner);
}

/** En ny rad måste bära den pushande användaren (en ändring kan inte byta den, se `immutableOnUpdate`). */
function checkActor(policy: RowPolicy, input: PolicyInput): RowPolicyRejection | null {
  const field = policy.actor;
  if (!field || input.existing || !input.incoming) return null;
  return input.incoming[field] === input.pusher.userId ? null : reject(ROW_POLICY_REASONS.actor);
}

/** En referens får inte peka på en annan byrås rad. */
async function checkRef(refOrg: RefOrg, org: string, entity: string, value: unknown): Promise<RowPolicyRejection | null> {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !isUuid(value)) return reject(ROW_POLICY_REASONS.badRef);
  const target = await refOrg(entity, value);
  return target === null || target === org ? null : reject(ROW_POLICY_REASONS.otherOrg);
}

async function checkRefs(policy: RowPolicy, input: PolicyInput): Promise<RowPolicyRejection | null> {
  const row = merged(input);
  if (!row || !policy.refs) return null;
  for (const [field, entity] of Object.entries(policy.refs)) {
    const rejected = await checkRef(input.refOrg, input.pusher.organizationId, entity, row[field]);
    if (rejected) return rejected;
  }
  return null;
}

/**
 * Värdet klienten sätter eller ändrar fältet till, annars `undefined`
 * (oförändrat eller inte skickat). Det enda ändringsprovet för `contentPath`,
 * `sameMatter` och `lockedWhen` (#2044).
 */
function changedValue(field: string, input: Pick<PolicyInput, "incoming" | "existing">): unknown {
  const value = input.incoming?.[field];
  return value === input.existing?.[field] ? undefined : value;
}

const isChanged = (field: string, input: PolicyInput): boolean => changedValue(field, input) !== undefined;

/**
 * Sökvägen till innehållet (#1372) prövas när den sätts eller ändras: rätt form
 * och dokumentets eget innehåll. En oförändrad sökväg (t.ex. seedens) går igenom.
 */
function checkContentPath(policy: RowPolicy, input: PolicyInput): RowPolicyRejection | null {
  const value = policy.contentPath === undefined ? undefined : changedValue(policy.contentPath, input);
  if (value === undefined) return null;
  const id = String(input.incoming?.id ?? input.existing?.id);
  return isDocumentStoragePath(value) && isOwnStoragePath(value, id) ? null : reject(ROW_POLICY_REASONS.contentPath);
}

/**
 * Låsta fält (#2044): ändrar klienten ett av fälten när en vakt är satt på
 * serverns rad, vägras raden. En ny rad har inga vakter på servern.
 */
function checkLocked(policy: RowPolicy, input: PolicyInput): RowPolicyRejection | null {
  const rule = policy.lockedWhen;
  if (!rule || !input.existing) return null;
  const existing = input.existing;
  if (!rule.guards.some((guard) => existing[guard] != null)) return null;
  return rule.fields.some((field) => isChanged(field, input)) ? reject(ROW_POLICY_REASONS.locked) : null;
}

/** Den refererade raden ligger i `matterId`; en tom referens och en saknad rad prövas inte. */
async function checkSameMatterRef(refMatter: RefMatter, entity: string, value: unknown, matterId: unknown): Promise<RowPolicyRejection | null> {
  if (typeof value !== "string") return null;
  const target = await refMatter(entity, value);
  return target === null || target === matterId ? null : reject(ROW_POLICY_REASONS.otherMatter);
}

/**
 * Samma ärende (#2044), prövat mot den sammanslagna raden när referensen eller
 * radens `matterId` sätts eller ändras. En gammal rad som inte stämmer stoppar
 * alltså inte en orelaterad ändring.
 */
async function checkSameMatter(policy: RowPolicy, input: PolicyInput): Promise<RowPolicyRejection | null> {
  const row = merged(input);
  if (!row || !policy.sameMatter) return null;
  const matterChanged = isChanged("matterId", input);
  for (const [field, entity] of Object.entries(policy.sameMatter)) {
    if (!matterChanged && !isChanged(field, input)) continue;
    const rejected = await checkSameMatterRef(input.refMatter, entity, row[field], row.matterId);
    if (rejected) return rejected;
  }
  return null;
}

/**
 * Får raden skrivas via radkön? `null` = ja. Byråavgränsningen av själva raden
 * (`checkScope`) och de procedurägda entiteterna prövas före.
 */
export async function checkRowPolicy(input: PolicyInput): Promise<RowPolicyRejection | null> {
  const policy = policyOf(input.entity);
  if (!policy) return reject(ROW_POLICY_REASONS.denied);
  return checkAppendOnly(policy, input.kind)
    ?? checkOwner(policy, input)
    ?? checkActor(policy, input)
    ?? checkContentPath(policy, input)
    ?? checkLocked(policy, input)
    ?? await checkRefs(policy, input)
    ?? await checkSameMatter(policy, input);
}

const CREATED_AT = "createdAt";

/** Fält som aldrig ändras efter skapandet: när raden skapades och vem som skapade den. */
function immutableFields(entity: string): string[] {
  const actor = policyOf(entity)?.actor;
  return actor ? [CREATED_AT, actor] : [CREATED_AT];
}

/** Fält som aldrig ändras av en radpush: när raden skapades och vem som skapade den. */
export function immutableOnUpdate(entity: string, patch: Row): Row {
  const fixed = new Set(immutableFields(entity));
  return Object.fromEntries(Object.entries(patch).filter(([k]) => !fixed.has(k)));
}

/** Samma tidpunkt? Databasen ger `Date`, klientens kö en ISO-sträng. */
function sameInstant(a: unknown, b: unknown): boolean {
  const ms = (v: unknown): number =>
    v instanceof Date || typeof v === "string" || typeof v === "number" ? new Date(v).getTime() : Number.NaN;
  return ms(a) === ms(b);
}

function sameImmutable(field: string, existing: unknown, incoming: unknown): boolean {
  return field === CREATED_AT ? sameInstant(existing, incoming) : existing === incoming;
}

/**
 * Är en create mot en rad servern redan har samma skapande — en omsändning av
 * samma köpost, t.ex. från flera flikar samtidigt (#1380)? De oföränderliga
 * fälten (när och av vem) måste stämma där klienten skickat dem. Skiljer de
 * sig är det en annan rad med samma id.
 */
export function isSameCreation(entity: string, existing: Row, incoming: Row): boolean {
  return immutableFields(entity).every(
    (field) => incoming[field] == null || sameImmutable(field, existing[field], incoming[field]),
  );
}
