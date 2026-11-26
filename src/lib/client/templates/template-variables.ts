/**
 * Mallredigerarens lista med variabler (#2119), bredvid kontexten
 * (`buildTemplateContext`) som fyller i dem. Listan visar bara det som fylls
 * i: testet `template-variables.test.ts` renderar varje nyckel mot ett fullt
 * ifyllt ärende och fäller den som blir tom. Hjälpfunktionernas beskrivningar
 * typas ur `TEMPLATE_HELPERS`, så att en hjälpfunktion inte kan saknas i
 * listan eller stå där utan att finnas.
 *
 * Det som står i kontexten men inte här (aliaset `client`, mottagarens
 * `phone`, `personalNumber` och `orgNumber`) finns kvar för sparade mallar.
 */

import type { TEMPLATE_HELPERS } from "@/lib/client/kostnadsrakning/render-handlebars";

/** En variabel i listan: hur den skrivs och vad som fylls i. */
export interface TemplateVariable {
  key: string;
  desc: string;
}

/** En grupp i panelen Variabler. */
export interface TemplateVariableGroup {
  group: string;
  vars: readonly TemplateVariable[];
}

/** Namnen på mallens hjälpfunktioner. */
export type TemplateHelperName = keyof typeof TEMPLATE_HELPERS;

/** Vad varje hjälpfunktion gör. */
export const TEMPLATE_HELPER_DESCRIPTIONS: Record<TemplateHelperName, string> = {
  formatDate: "Datum → 16 april 2026",
  formatDateShort: "Datum → 2026-04-16",
  formatAmount: "Öre → 1 250,00 kr",
  formatHours: "Minuter → decimaltimmar, 90 → 1,5",
};

/** Argumentet i exemplet för varje hjälpfunktion. */
const TEMPLATE_HELPER_ARGS: Record<TemplateHelperName, string> = {
  formatDate: "date",
  formatDateShort: "date",
  formatAmount: "amountInOre",
  formatHours: "minutes",
};

function helperVariables(): TemplateVariable[] {
  // Object.keys tappar nyckeltypen; posten är uttömmande över TemplateHelperName (Record-typen ovan).
  return (Object.keys(TEMPLATE_HELPER_DESCRIPTIONS) as TemplateHelperName[]).map((name) => ({
    key: `{{${name} ${TEMPLATE_HELPER_ARGS[name]}}}`,
    desc: TEMPLATE_HELPER_DESCRIPTIONS[name],
  }));
}

/** Gruppen med hjälpfunktionerna. Den hålls ihop med `TEMPLATE_HELPERS` av typen ovan. */
export const TEMPLATE_HELPER_GROUP = "Hjälpfunktioner";

/** Variablerna som redigeraren visar, i panelens ordning. */
export const TEMPLATE_VARIABLES: readonly TemplateVariableGroup[] = [
  {
    group: "Ärende",
    vars: [
      { key: "matter.matterNumber", desc: "Ärendenummer (t.ex. 2024-0001)" },
      { key: "matter.title", desc: "Ärendetitel" },
      { key: "matter.description", desc: "Beskrivning" },
      { key: "matter.status", desc: "Status (Aktivt, Stängt, Arkiverat)" },
      { key: "matter.matterType", desc: "Ärendetyp" },
      { key: "matter.createdAt", desc: "Skapat datum, ÅÅÅÅ-MM-DD (använd med {{formatDate}})" },
    ],
  },
  {
    group: "Organisation",
    vars: [
      { key: "organization.name", desc: "Byråns namn" },
      { key: "organization.address", desc: "Byråns adress" },
      { key: "organization.phone", desc: "Byråns telefon" },
      { key: "organization.email", desc: "Byråns e-post" },
      { key: "organization.orgNumber", desc: "Org.nummer" },
      { key: "organization.bankgiro", desc: "Bankgiro" },
      { key: "organization.mainOffice.name", desc: "Huvudkontorets namn" },
      { key: "organization.mainOffice.address", desc: "Huvudkontorets adress" },
      { key: "organization.offices", desc: "Alla kontor (loop)" },
      { key: "organization.offices[i].name", desc: "Kontorets namn" },
      { key: "organization.offices[i].address", desc: "Kontorets adress" },
      { key: "organization.offices[i].phone", desc: "Kontorets telefon" },
    ],
  },
  {
    group: "Parter",
    vars: [
      { key: "klient.name", desc: "Klientens namn (ärendets första klient)" },
      { key: "klient.personalNumber", desc: "Klientens personnummer" },
      { key: "klient.address", desc: "Klientens adress" },
      { key: "klient.phone", desc: "Klientens telefon" },
      { key: "klient.email", desc: "Klientens e-post" },
      { key: "motpart.name", desc: "Motpartens namn (ärendets första motpart)" },
      { key: "recipient.name", desc: "Vald mottagares namn (tomt om ingen är vald)" },
      { key: "recipient.address", desc: "Vald mottagares adress" },
      { key: "recipient.email", desc: "Vald mottagares e-post" },
      { key: "recipient.roleLabel", desc: "Mottagarens roll (t.ex. Klient, Motpart)" },
      { key: "contacts", desc: "Alla parter (loop)" },
      { key: "contacts[i].name", desc: "Partens namn" },
      { key: "contacts[i].roleLabel", desc: "Partens roll (t.ex. Klient)" },
    ],
  },
  {
    group: "Övrigt",
    vars: [
      { key: "today", desc: "Dagens datum, ÅÅÅÅ-MM-DD (t.ex. 2026-04-16)" },
      { key: "generatedBy.name", desc: "Den som skapar dokumentet (namn)" },
      { key: "generatedBy.title", desc: "Den som skapar dokumentets titel" },
    ],
  },
  { group: TEMPLATE_HELPER_GROUP, vars: helperVariables() },
];
