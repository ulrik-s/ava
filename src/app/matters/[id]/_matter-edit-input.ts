/**
 * Ärendeuppgifterna i "Ändra ärende"-dialogen (#1565): startvärden ur ärendet
 * och omvandling till den del av `matter.update`-indata som inte är
 * betalningsdelen (den byggs av `usePaymentMethodForm`).
 */

/** Ärendets sparade uppgifter som dialogen utgår från. */
export interface MatterDetailsInitial {
  title: string;
  matterType?: string | null | undefined;
  description?: string | null | undefined;
  courtCaseNumber: string;
  insuranceReference: string;
}

/** Fältens värden som de står i dialogen. */
export interface MatterDetailsValues {
  title: string;
  /** Vald ärendetyp; `""` = förstavalet "Välj ärendetyp…". */
  matterType: string;
  courtCaseNumber: string;
  insuranceReference: string;
  description: string;
}

/** Ärendeuppgifternas del av `matter.update`-indata. */
export interface MatterDetailsUpdateInput {
  title: string;
  description: string;
  courtCaseNumber: string | null;
  /** Utelämnas när fältet inte visas, så att den sparade referensen står kvar. */
  insuranceReference?: string | null;
  /** Utelämnas utan val ur byråns lista, så att ärendets typ står kvar. */
  matterType?: string;
}

/** Vad dialogen visar, som styr vilka fält som skickas. */
export interface MatterDetailsContext {
  /** Byråns ärendetyper. */
  matterTypes: readonly string[];
  /** Sant när försäkringsreferensen visas (`hasInsuranceCompany`). */
  showInsuranceReference: boolean;
}

/** Startvärden ur ärendets sparade uppgifter. */
export function matterDetailsFromMatter(m: MatterDetailsInitial): MatterDetailsValues {
  return {
    title: m.title,
    matterType: m.matterType ?? "",
    courtCaseNumber: m.courtCaseNumber,
    insuranceReference: m.insuranceReference,
    description: m.description ?? "",
  };
}

/** Ärendetypen som ska sparas: bara ett val ur byråns lista. */
function chosenMatterType(v: MatterDetailsValues, ctx: MatterDetailsContext): Pick<MatterDetailsUpdateInput, "matterType"> {
  return ctx.matterTypes.includes(v.matterType) ? { matterType: v.matterType } : {};
}

/** Försäkringsreferensen som ska sparas: bara när fältet visas. */
function shownInsuranceReference(v: MatterDetailsValues, ctx: MatterDetailsContext): Pick<MatterDetailsUpdateInput, "insuranceReference"> {
  return ctx.showInsuranceReference ? { insuranceReference: v.insuranceReference || null } : {};
}

/** Dialogens värden → ärendeuppgifternas del av `matter.update`-indata. */
export function matterDetailsInput(v: MatterDetailsValues, ctx: MatterDetailsContext): MatterDetailsUpdateInput {
  return {
    title: v.title,
    description: v.description,
    courtCaseNumber: v.courtCaseNumber || null,
    ...shownInsuranceReference(v, ctx),
    ...chosenMatterType(v, ctx),
  };
}

/** Titeln är obligatorisk (servern kräver minst ett tecken). */
export function canSaveMatterDetails(v: MatterDetailsValues): boolean {
  return v.title.trim().length > 0;
}
