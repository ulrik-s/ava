/**
 * Single source of truth för domän-enums (MatterRole, ContactType).
 *
 * Allt härleds från två objektliteraler:
 *   - `MATTER_ROLE_LABELS` — {ROLE_KEY: "Svensk label"}
 *   - `CONTACT_TYPE_LABELS` — {TYPE_KEY: "Svensk label"}
 *
 * Från dessa exporteras:
 *   • Union-typ (`MatterRole`, `ContactType`) — typsäkra nycklar
 *   • zod-schema (`matterRoleSchema`, `contactTypeSchema`) — runtime-validering
 *   • Dropdown-listor (`matterRoleOptions`, `contactTypeOptions`) — {value,label}-tupler
 *   • Typade label-helpers (`labelForMatterRole`, `labelForContactType`)
 *
 * Om en ny roll/typ läggs till: lägg till ett fält i rätt objektliteral nedan.
 * Allt annat uppdateras automatiskt — TS-typer, zod-enum, dropdown, label-helper.
 *
 * Bakåtkompatibla aliaser (`matterRoleLabels`, `matterRoles`, etc.) finns i
 * slutet av filen så att befintlig kod (och låsta tester) fortsätter fungera.
 */

import { z } from "zod";

// ─── Matter roles ────────────────────────────────────────────────

export const MATTER_ROLE_LABELS = {
  KLIENT: "Klient",
  MOTPART: "Motpart",
  MOTPARTSOMBUD: "Motpartsombud",
  AKLAGARE: "Åklagare",
  DOMSTOL: "Domstol",
  FORSAKRINGSBOLAG: "Försäkringsbolag",
  VITTNE: "Vittne",
  OMBUD: "Ombud",
  OVRIG: "Övrig",
} as const satisfies Record<string, string>;

export type MatterRole = keyof typeof MATTER_ROLE_LABELS;

const matterRoleKeys = Object.keys(MATTER_ROLE_LABELS) as [MatterRole, ...MatterRole[]];

export const matterRoleSchema = z.enum(matterRoleKeys);

export type MatterRoleOption = { readonly value: MatterRole; readonly label: string };

export const matterRoleOptions: ReadonlyArray<MatterRoleOption> = matterRoleKeys.map(
  (value) => ({ value, label: MATTER_ROLE_LABELS[value] }),
);

/** Säker label-lookup: accepterar okänd input men smalnar av om argumentet är typat. */
export function labelForMatterRole(role: MatterRole): string;
export function labelForMatterRole(role: string): string;
export function labelForMatterRole(role: string): string {
  return (MATTER_ROLE_LABELS as Record<string, string>)[role] ?? role;
}

/** Runtime-guard — användbar när DB-data kommer in som rå sträng. */
export function isMatterRole(v: unknown): v is MatterRole {
  return typeof v === "string" && v in MATTER_ROLE_LABELS;
}

// ─── Contact types ───────────────────────────────────────────────

export const CONTACT_TYPE_LABELS = {
  PERSON: "Person",
  COMPANY: "Företag",
  COURT: "Domstol",
  AUTHORITY: "Myndighet",
  INSURANCE_COMPANY: "Försäkringsbolag",
  LAW_FIRM: "Advokatbyrå",
  OTHER: "Övrig",
} as const satisfies Record<string, string>;

export type ContactType = keyof typeof CONTACT_TYPE_LABELS;

const contactTypeKeys = Object.keys(CONTACT_TYPE_LABELS) as [ContactType, ...ContactType[]];

export const contactTypeSchema = z.enum(contactTypeKeys);

export type ContactTypeOption = { readonly value: ContactType; readonly label: string };

export const contactTypeOptions: ReadonlyArray<ContactTypeOption> = contactTypeKeys.map(
  (value) => ({ value, label: CONTACT_TYPE_LABELS[value] }),
);

export function labelForContactType(type: ContactType): string;
export function labelForContactType(type: string): string;
export function labelForContactType(type: string): string {
  return (CONTACT_TYPE_LABELS as Record<string, string>)[type] ?? type;
}

export function isContactType(v: unknown): v is ContactType {
  return typeof v === "string" && v in CONTACT_TYPE_LABELS;
}

// ─── Payment method (betalningssätt på ärende) ──────────────────

export const PAYMENT_METHOD_LABELS = {
  PENDING: "Ej fastställt",
  RATTSHJALP: "Rättshjälp",
  RATTSSKYDD: "Rättsskydd",
  OFFENTLIG_FORSVARARE: "Offentlig försvarare",
  PRIVAT: "Privat betalning",
  MIX: "Kombinerad",
} as const satisfies Record<string, string>;

export type PaymentMethod = keyof typeof PAYMENT_METHOD_LABELS;

const paymentMethodKeys = Object.keys(PAYMENT_METHOD_LABELS) as [PaymentMethod, ...PaymentMethod[]];

export const paymentMethodSchema = z.enum(paymentMethodKeys);

export type PaymentMethodOption = { readonly value: PaymentMethod; readonly label: string };

export const paymentMethodOptions: ReadonlyArray<PaymentMethodOption> = paymentMethodKeys.map(
  (value) => ({ value, label: PAYMENT_METHOD_LABELS[value] }),
);

export function labelForPaymentMethod(v: string): string {
  return (PAYMENT_METHOD_LABELS as Record<string, string>)[v] ?? v;
}

/**
 * Kreditriskbedömning baserat på betalningssätt — påverkar vilken status
 * rapportsidan visar för ofakturerat arbete.
 */
export type CreditRisk = "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";

export function creditRiskFor(method: string): CreditRisk {
  switch (method) {
    case "RATTSHJALP":
    case "OFFENTLIG_FORSVARARE":
    case "RATTSSKYDD":
      return "LOW";       // staten eller försäkringsbolag betalar
    case "MIX":
      return "MEDIUM";    // delvis privat
    case "PRIVAT":
      return "HIGH";      // hela risken ligger på klienten
    case "PENDING":
    default:
      return "UNKNOWN";
  }
}

export const CREDIT_RISK_LABELS: Record<CreditRisk, string> = {
  LOW: "Låg",
  MEDIUM: "Medel",
  HIGH: "Hög",
  UNKNOWN: "Okänd",
};

// ─── Bakåtkompatibla aliaser ────────────────────────────────────
// Behåller gamla namn så att existerande komponenter och det låsta
// labels.test.ts fortsätter fungera utan ändringar.

export const matterRoleLabels = MATTER_ROLE_LABELS;
export const contactTypeLabels = CONTACT_TYPE_LABELS;
export const matterRoles = matterRoleOptions;
export const contactTypes = contactTypeOptions;
