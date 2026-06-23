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

import {
  MATTER_ROLE_LABELS,
  matterRoleSchema,
  type MatterRole,
  CONTACT_TYPE_LABELS,
  contactTypeSchema,
  type ContactType,
  PAYMENT_METHOD_LABELS,
  paymentMethodSchema,
  type PaymentMethod,
} from "@/lib/shared/schemas/enums";

// MatterRole/ContactType/PaymentMethod — labels + schema + typ bor i
// shared/schemas/enums.ts (delad kod, synlig för alla lager). Här re-exporteras
// de tillsammans med de UI-nära derivationerna (dropdown-options, label-helpers,
// runtime-guards).
export { MATTER_ROLE_LABELS, matterRoleSchema, CONTACT_TYPE_LABELS, contactTypeSchema };
export type { MatterRole, ContactType };

// ─── Matter roles (UI-derivationer) ──────────────────────────────

const matterRoleKeys = Object.keys(MATTER_ROLE_LABELS) as [MatterRole, ...MatterRole[]];

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

/**
 * Runtime-guard — användbar när DB-data kommer in som rå sträng.
 * @public — avsedd hjälpfunktion (ännu ej konsumerad internt).
 */
export function isMatterRole(v: unknown): v is MatterRole {
  return typeof v === "string" && v in MATTER_ROLE_LABELS;
}

// ─── Contact types (UI-derivationer) ─────────────────────────────

const contactTypeKeys = Object.keys(CONTACT_TYPE_LABELS) as [ContactType, ...ContactType[]];

export type ContactTypeOption = { readonly value: ContactType; readonly label: string };

export const contactTypeOptions: ReadonlyArray<ContactTypeOption> = contactTypeKeys.map(
  (value) => ({ value, label: CONTACT_TYPE_LABELS[value] }),
);

export function labelForContactType(type: ContactType): string;
export function labelForContactType(type: string): string;
export function labelForContactType(type: string): string {
  return (CONTACT_TYPE_LABELS as Record<string, string>)[type] ?? type;
}

/**
 * Runtime-guard — motsvarar `isMatterRole` för kontakt-typer.
 * @public — avsedd hjälpfunktion (ännu ej konsumerad internt).
 */
export function isContactType(v: unknown): v is ContactType {
  return typeof v === "string" && v in CONTACT_TYPE_LABELS;
}

// ─── Payment method (UI-derivationer) ────────────────────────────
// PAYMENT_METHOD-enumet bor i shared/schemas/enums.ts (delad källa,
// schema-validering). Här re-exporteras det + UI-derivationerna.
export { PAYMENT_METHOD_LABELS, paymentMethodSchema };
export type { PaymentMethod };

const paymentMethodKeys = Object.keys(PAYMENT_METHOD_LABELS) as [PaymentMethod, ...PaymentMethod[]];

export type PaymentMethodOption = { readonly value: PaymentMethod; readonly label: string };

export const paymentMethodOptions: ReadonlyArray<PaymentMethodOption> = paymentMethodKeys.map(
  (value) => ({ value, label: PAYMENT_METHOD_LABELS[value] }),
);

export function labelForPaymentMethod(v: PaymentMethod): string {
  return PAYMENT_METHOD_LABELS[v];
}

/**
 * Kreditriskbedömning baserat på betalningssätt — påverkar vilken status
 * rapportsidan visar för ofakturerat arbete.
 */
export type CreditRisk = "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";

export function creditRiskFor(method: PaymentMethod): CreditRisk {
  switch (method) {
    case "RATTSHJALP":
    case "OFFENTLIGT_UPPDRAG":
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
