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
 *   - loggar (`appendOnly`): jävskontrollens logg kan bara läggas till.
 *
 * Användare, byrån, kontor, byråns standardvyer och mallar tas inte emot här:
 * de är procedurägda (`procedure-owned.ts`) och skrivs bara genom att servern
 * kör om routern — där gäller rollen (admin) och vilka fält som får ändras.
 */

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
}

const USER = "user";
const MATTER = "matter";
const DOCUMENT = "document";

/** Entiteterna radkön tar emot. Allt annat avvisas (neka som standard). */
export const ROW_PUSH_POLICY: Readonly<Record<string, RowPolicy>> = Object.freeze({
  contact: { refs: { parentId: "contact" } },
  matterContact: { refs: { matterId: MATTER, contactId: "contact" } },
  task: { refs: { userId: USER, matterId: MATTER } },
  calendarEvent: { refs: { userId: USER, matterId: MATTER } },
  document: {
    refs: { matterId: MATTER, folderId: "documentFolder", invoiceId: "invoice", billingRunId: "billingRun" },
    actor: "uploadedById",
  },
  documentFolder: { refs: { matterId: MATTER, parentId: "documentFolder" } },
  documentPart: { refs: { matterId: MATTER, documentId: DOCUMENT } },
  documentAnalysisSuggestion: { refs: { documentId: DOCUMENT, acceptedContactId: "contact" } },
  matterEventSuggestion: { refs: { documentId: DOCUMENT } },
  serviceNote: { refs: { matterId: MATTER }, actor: "authorId" },
  userPreference: { owner: "userId" },
  conflictCheck: { actor: "checkedById", appendOnly: true },
});

/** Beskeden när policyn avvisar en rad. */
export const ROW_POLICY_REASONS = {
  denied: "Servern tar inte emot den här ändringen som rad. Gör om den i appen.",
  appendOnly: "Raden kan inte ändras eller tas bort i efterhand.",
  owner: "Raden tillhör en annan användare.",
  actor: "Raden måste skapas i ditt eget namn.",
  badRef: "ogiltig referens",
  otherOrg: "annan byrå",
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

/** Det policyn prövar: vad som skickades, vad servern har och vem som pushar. */
export interface PolicyInput {
  readonly entity: string;
  readonly kind: "create" | "update" | "delete";
  readonly incoming: Row | null;
  readonly existing: Row | null;
  readonly pusher: RowPusher;
  readonly refOrg: RefOrg;
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
 * Får raden skrivas via radkön? `null` = ja. Byråavgränsningen av själva raden
 * (`checkScope`) och de procedurägda entiteterna prövas före.
 */
export async function checkRowPolicy(input: PolicyInput): Promise<RowPolicyRejection | null> {
  const policy = policyOf(input.entity);
  if (!policy) return reject(ROW_POLICY_REASONS.denied);
  return checkAppendOnly(policy, input.kind)
    ?? checkOwner(policy, input)
    ?? checkActor(policy, input)
    ?? await checkRefs(policy, input);
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
