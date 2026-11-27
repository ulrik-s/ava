/**
 * Byråinställningarna (`organization.updateSettings`), utbrutet ur routern
 * (#2176): vem som får ändra vad, normaliseringen av listorna och följden
 * för befintliga ärenden. Tar repona och anropet explicit.
 */
import { TRPCError } from "@trpc/server";
import { isCustomKind, normalizeKinds } from "@/lib/shared/document-kinds";
import { PUBLIC_ASSIGNMENT_METHOD } from "@/lib/shared/public-assignment";
import type { UserRole } from "@/lib/shared/schemas/enums";
import { asId } from "@/lib/shared/schemas/ids";
import type { Organization } from "@/lib/shared/schemas/organization";
import { normalizeStandardAtgarder } from "@/lib/shared/standard-atgard";
import type { Principal } from "../auth/principal";
import { applyPaymentMethodToExistingMatters } from "../billing/matter-payment-method";
import { emit } from "../events/emit";
import type { QueuedCallScope } from "../queued-call";
import type { Context } from "../trpc-core";

/**
 * Byråinställningar en medlem får ändra (#1370): bara byråns egna dokumenttyper
 * (ADR 0038; tidigare etikett-vokabulären), som juristerna använder i sitt
 * dagliga arbete. Allt annat syns på
 * dokument och fakturor eller styr betalningar, bokföring och prissättning
 * (byrånamn, adress, logotyp, sigill, bankgiro, kontoplan, timpriser …) och
 * ändras bara av admin (#1344). En medlem kan skicka hela formuläret så länge
 * de övriga fälten är oförändrade.
 */
const MEMBER_SETTINGS: ReadonlySet<string> = new Set(["documentKinds", "documentTags"]);

/**
 * Byråns egna typer ur indata (ADR 0038): normaliserade, utan dubbletter och
 * utan inbyggda typer (de finns redan). Den äldre formen `documentTags` tas
 * emot från gamla klienter och blir samma lista; taggfältet töms.
 */
function withOrganizationKinds<P extends { documentKinds?: string[]; documentTags?: string[] }>(patch: P): P {
  const list = patch.documentKinds ?? patch.documentTags;
  if (!list) return patch;
  return { ...patch, documentKinds: normalizeKinds(list).filter(isCustomKind), documentTags: [] };
}

/** Trimma, släng tomma, dedupa (set-semantik, ordningen behålls). */
function normalizeVocabulary(list: readonly string[]): string[] {
  return [...new Set(list.map((t) => t.trim()).filter(Boolean))];
}

type MatterTypesPatch = { matterTypes?: string[]; publicAssignmentMatterTypes?: string[] };

/**
 * Markeringen att indata ska ersätta (#1638): den skickade listan, eller —
 * när bara ärendetyperna ändras — den sparade, så att en borttagen typ också
 * försvinner ur markeringen. Aldrig satt (`null`) förblir aldrig satt.
 */
function publicAssignmentInput(patch: MatterTypesPatch, current: Organization | null): readonly string[] | undefined {
  if (patch.publicAssignmentMatterTypes) return patch.publicAssignmentMatterTypes;
  if (!patch.matterTypes) return undefined;
  return current?.publicAssignmentMatterTypes ?? undefined;
}

/**
 * Offentligt uppdrag (#1638): hela listan ersätts, normaliserad som
 * ärendetyperna, och bara med namn som finns bland byråns ärendetyper
 * (de nya i samma anrop, annars de sparade).
 */
function withPublicAssignmentTypes<P extends MatterTypesPatch>(patch: P, current: Organization | null): P {
  const list = publicAssignmentInput(patch, current);
  if (!list) return patch;
  const known = new Set(patch.matterTypes ?? current?.matterTypes);
  return { ...patch, publicAssignmentMatterTypes: normalizeVocabulary(list).filter((t) => known.has(t)) };
}

/** Det `updateSettings` behöver ur anropet för att byta befintliga ärenden. */
export type SettingsCtx = QueuedCallScope & Pick<Context, "repos" | "dataStore"> & { user: Principal };

/**
 * Befintliga ärenden (#1640): när anropet sparar ärendetyperna eller
 * markeringen och markeringen inte är tom, får byråns ärenden med en markerad
 * typ betalningssättet Offentligt uppdrag, med admin som författare till
 * anteckningarna. Urkryssning eller andra inställningar ändrar inga ärenden.
 */
async function applyToExistingMatters(ctx: SettingsCtx, marked: readonly string[] | undefined): Promise<void> {
  if (!marked?.length) return;
  const noteCtx = { ...ctx, orgId: ctx.user.organizationId };
  const ids = await ctx.repos.transaction((repos) =>
    applyPaymentMethodToExistingMatters(repos, noteCtx, { publicAssignmentMatterTypes: marked }));
  for (const id of ids) await emit.matterUpdated(ctx, id, { paymentMethod: PUBLIC_ASSIGNMENT_METHOD });
}

/** Objektets nycklar i sorterad ordning — jämförelsen ska inte bero på ordningen. */
function sortedKeys(_key: string, v: unknown): unknown {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return v;
  return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)));
}

/** Tomt fält, tom lista/karta och saknat räknas lika. */
const EMPTY_SETTING: ReadonlySet<string> = new Set(["null", '""', "{}", "[]"]);

/** Jämförbart värde (`null` = tomt). */
function settingValue(v: unknown): string | null {
  const json = JSON.stringify(v ?? null, sortedKeys);
  return EMPTY_SETTING.has(json) ? null : json;
}

/** Kasta FORBIDDEN om en icke-admin försöker ändra något annat än medlemsfälten. */
function assertMayChangeSettings(role: UserRole, current: Organization | null, patch: Partial<Organization>): void {
  if (role === "ADMIN") return;
  const before: Readonly<Record<string, unknown>> = current ?? {};
  const changed = Object.entries(patch)
    .filter(([k, v]) => !MEMBER_SETTINGS.has(k) && settingValue(v) !== settingValue(before[k]))
    .map(([k]) => k);
  if (changed.length > 0) {
    throw new TRPCError({ code: "FORBIDDEN", message: `Endast administratörer kan ändra byråns uppgifter: ${changed.join(", ")}.` });
  }
}

/** Ändringen `updateSettings` tar emot, utan utelämnade fält (routern validerar). */
export type OrgSettingsPatch = Partial<Organization> & MatterTypesPatch;

/**
 * Spara byråinställningarna: en icke-admin får bara ändra medlemsfälten,
 * listorna normaliseras och markerade ärendetyper slår igenom på befintliga
 * ärenden (#1640). Ger den sparade byrån.
 */
export async function updateOrgSettings(ctx: SettingsCtx, input: OrgSettingsPatch): Promise<Organization> {
  const orgId = asId<"OrganizationId">(ctx.user.organizationId);
  // Normalisera vokabulären: trimma, släng tomma, dedupa (set-semantik).
  const patch = { ...input };
  const current = await ctx.repos.organizations.getById(orgId);
  assertMayChangeSettings(ctx.user.role, current, patch);
  if (patch.matterTypes) patch.matterTypes = normalizeVocabulary(patch.matterTypes);
  if (patch.standardAtgarder) patch.standardAtgarder = normalizeStandardAtgarder(patch.standardAtgarder);
  const normalized = withPublicAssignmentTypes(withOrganizationKinds(patch), current);
  const saved = await ctx.repos.organizations.update(orgId, normalized satisfies Partial<Organization>);
  await applyToExistingMatters(ctx, normalized.publicAssignmentMatterTypes);
  return saved;
}
