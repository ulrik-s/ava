/**
 * Delade partials för dokumentmallarna (ADR 0042) — byggstenar som fakturan
 * använder i dag och som kostnadsräkning, brev och påminnelser ska återanvända.
 * En mall når dem med `{{> namn}}`.
 *
 * - `stilar` — de namngivna stilarna (`dämpad` text, `linje` för tunna streck).
 *   Står först i `<document>`; de andra partialerna förutsätter dem.
 * - `brevhuvud` — byråns logga uppe till höger, dokumentets rubrik i versaler
 *   (`rubrik=…`), byråns namn och organisationsnummer.
 * - `betalningsuppgifter` — det en betalning hänvisar till: dokumentnummer,
 *   datum, mottagare och OCR-referens.
 * - `sidfot` — byrånamn, organisationsnummer och "Sida x av y" längst ned på
 *   varje sida. Fakturan använder den inte än (oförändrad layout i fas 1); den
 *   läggs till med `{{> sidfot}}` i mallen.
 *
 * Kontexten följer fakturans vy-modell (`FakturaView`): `logo`,
 * `organizationName`, `organizationOrgNumber`, `invoiceNumber`, `date`,
 * `recipient`, `ocr`.
 */

const STILAR = `
<style name="dämpad" color="0.45"/>
<style name="linje" color="0.72"/>
`;

const BREVHUVUD = `
{{#if logo}}
  <block at="top-right" top="27" width="170"><image src="logo" width="170" height="56" align="right"/></block>
{{/if}}
<text size="20" font="bold" leading="26">{{upper rubrik}}</text>
{{#if organizationName}}<text font="bold" leading="13">{{organizationName}}</text>{{/if}}
{{#if organizationOrgNumber}}<text size="9" leading="13" style="dämpad">Org.nr {{organizationOrgNumber}}</text>{{/if}}
<spacer height="6"/>
`;

const BETALNINGSUPPGIFTER = `
<text leading="14">Fakturanr: {{invoiceNumber}}</text>
<text leading="14">Fakturadatum: {{date}}</text>
<text leading="14">Mottagare: {{recipient}}</text>
{{#if ocr}}<text font="bold" leading="14">OCR-referens: {{ocr}}</text>{{/if}}
`;

const SIDFOT = `
<page-footer top="815">
  <text size="8" align="center" style="dämpad">{{organizationName}}{{#if organizationOrgNumber}} · Org.nr {{organizationOrgNumber}}{{/if}} · Sida {{pageNumber}} av {{pageCount}}</text>
</page-footer>
`;

/** De delade partialerna, per namn. */
export const SHARED_PARTIALS: Readonly<Record<string, string>> = {
  stilar: STILAR,
  brevhuvud: BREVHUVUD,
  betalningsuppgifter: BETALNINGSUPPGIFTER,
  sidfot: SIDFOT,
};
