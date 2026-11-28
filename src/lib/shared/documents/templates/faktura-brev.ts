/**
 * Byråns fakturamall (#2255; intag #149/#150/#151) — fakturan som byrån får,
 * för alla fakturatyper (faktura, aconto, kredit, rådgivning). Handlebars över
 * layoutspråket (ADR 0042); kontexten är `FakturaView` (`buildFakturaView`):
 * allt är färdigformaterat, mallen räknar ingenting.
 *
 *   sida 1  logga centrerad · mottagaren i fönsterkuvertet · "FAKTURA NR …" och
 *           "Ange endast fakturanummer vid betalning tack!" · uppgiftsblocket
 *           (klient, fakturadag, förfallodag, ärendenr, bankgiro) ·
 *           dröjsmålsräntan · fakturaraderna · avräkningstabellen ·
 *           summeringsrutan (exkl moms, moms, inkl moms) på grå botten med
 *           en tjock linje under.
 *   sida 2+ specifikationen: tidsspecifikation per arvodeskategori med
 *           delsumma och utläggsspecifikation med summarad.
 *   varje sida  sidfoten med byråns uppgifter och sigill.
 *
 * Sidan är ISO-A4 i Times med marginaler 20 mm; första sidans flöde börjar
 * under fönsteradressen (215 pt ≈ 76 mm, som kostnadsräkningens rubrik),
 * följande sidors 60 pt från överkanten, och flödet slutar ovanför sidfoten.
 */

import type { DocumentTemplateSource } from "../template-source";
import { SHARED_PARTIALS } from "./partials";

const FAKTURARADER = `
<table size="10.5" keep-extra="5" repeat-header="false">
  <col width="*" wrap="true"/><col width="50" align="right"/><col width="95" align="right"/><col width="95" align="right"/>
  <thead keep="60">
    <row style="kolumnrubrik" leading="6"><cell>Benämning</cell><cell>Tim</cell><cell>Timpris</cell><cell>Belopp</cell></row>
    <rule style="linje" space-after="14"/>
  </thead>
  {{#each summary}}
    {{#if subtotal}}<rule style="linje" keep="30" space-before="-4" space-after="14"/>{{/if}}
    <row leading="15" font="{{#if subtotal}}bold{{else}}regular{{/if}}">
      <cell>{{label}}</cell><cell>{{hours}}</cell><cell>{{rateLabel}}</cell><cell>{{amount}}</cell>
    </row>
  {{/each}}
  {{#if showSummaryTotal}}
  <tfoot keep="30">
    <rule style="linje" space-before="-3" space-after="15"/>
    <row font="bold" leading="20"><cell>{{summaryTotalLabel}}</cell><cell/><cell/><cell>{{summaryTotal}}</cell></row>
  </tfoot>
  {{/if}}
</table>
`;

/** Summeringsrutan: grå botten över hela bredden (rad för rad), tjock linje direkt under. */
const SUMMERING = `
<spacer height="10"/>
<table size="11" fill="#f2f2f2" repeat-header="false">
  <col width="*"/><col width="120" align="right"/>
  <tfoot keep="60">
    <row leading="18"><cell>Belopp exkl. moms</cell><cell>{{totals.exclVat}}</cell></row>
    <row leading="18"><cell>{{totals.vatLabel}}</cell><cell>{{totals.vat}}</cell></row>
    <row leading="18" font="bold"><cell>Belopp inkl. moms</cell><cell>{{totals.inclVat}}</cell></row>
  </tfoot>
</table>
<rule thickness="2.2" space-before="-12.96" space-after="18"/>
{{#if footnote}}<text size="9" leading="12" style="dämpad">{{footnote}}</text>{{/if}}
`;

/** Specifikationstabellernas gemensamma rubrik- och summaradsstil. */
const SPEC_HEAD_RULE = `<rule style="linje" space-after="13"/>`;
const SPEC_TOTAL_RULE = `<rule style="linje" space-before="2" space-after="11"/>`;

const TIDSSPECIFIKATION = `
{{#if timeGroups}}
<text keep="90" size="12" font="bold" leading="18">Tidsspecifikation</text>
{{#each timeGroups}}
  <text keep="70" size="11" font="bold" leading="14">{{label}}</text>
  <table size="10" keep-extra="6" repeat-header="true">
    <col width="66"/><col width="*" wrap="true"/><col width="46" align="right"/>{{#if @root.showTimeAmounts}}<col width="80" align="right"/>{{/if}}
    <thead keep="40">
      <row style="kolumnrubrik" leading="5"><cell>Datum</cell><cell>Beskrivning</cell><cell>Tim</cell>{{#if @root.showTimeAmounts}}<cell>Belopp</cell>{{/if}}</row>
      ${SPEC_HEAD_RULE}
    </thead>
    {{#each lines}}
      <row leading="12.5" space-after="2">
        <cell>{{date}}</cell><cell>{{description}}</cell><cell>{{hours}}</cell>{{#if @root.showTimeAmounts}}<cell>{{amount}}</cell>{{/if}}
      </row>
    {{/each}}
    <tfoot keep="30">
      ${SPEC_TOTAL_RULE}
      <row font="bold" leading="20"><cell>{{subtotalLabel}}</cell><cell/><cell>{{hours}}</cell>{{#if @root.showTimeAmounts}}<cell>{{amount}}</cell>{{/if}}</row>
    </tfoot>
  </table>
{{/each}}
{{/if}}
`;

const UTLAGGSSPECIFIKATION = `
{{#if expenseLines}}
<text keep="60" size="12" font="bold" leading="16">Utläggsspecifikation</text>
<table size="10" keep-extra="6" repeat-header="true">
  <col width="66"/><col width="*" wrap="true"/><col width="60" align="right"/><col width="75" align="right"/>
  <thead keep="40">
    <row style="kolumnrubrik" leading="5"><cell>Datum</cell><cell>Beskrivning</cell><cell>Netto</cell><cell>Brutto</cell></row>
    ${SPEC_HEAD_RULE}
  </thead>
  {{#each expenseLines}}
    <row leading="12.5" space-after="2"><cell>{{date}}</cell><cell>{{description}}</cell><cell>{{net}}</cell><cell>{{gross}}</cell></row>
  {{/each}}
  <tfoot keep="30">
    ${SPEC_TOTAL_RULE}
    <row font="bold" leading="20"><cell>Summa utlägg</cell><cell/><cell>{{expenseNetTotal}}</cell><cell>{{expenseGrossTotal}}</cell></row>
  </tfoot>
</table>
{{/if}}
`;

const SPECIFIKATION = `
{{#if hasSpec}}
<page-break/>
<text size="13" font="bold" leading="15">Specifikation</text>
<text size="10" leading="20" style="dämpad">Underlag till fakturan {{invoiceNumber}}, ärende {{matterNumber}}.</text>
{{> tidsspecifikation}}
{{> utlaggsspecifikation}}
{{/if}}
`;

const FAKTURA = `
<document size="A4" margin-top="60" margin-right="20mm" margin-bottom="85" margin-left="20mm"
          font-family="times" title="{{heading}} {{invoiceNumber}}" subject="Faktura">
{{> stilar}}
{{> sidfot}}
{{> brevhuvud}}
<spacer height="155"/>
{{> betalningsuppgifter}}
{{> fakturarader}}
{{#if settlementRows}}<spacer height="12"/>{{> avrakning}}{{/if}}
{{> summering}}
{{> specifikation}}
</document>
`;

/** Byråns fakturamall med sina partials (de delade + fakturans egna avsnitt). */
export const FAKTURA_BREV_TEMPLATE: DocumentTemplateSource = {
  template: FAKTURA,
  partials: {
    ...SHARED_PARTIALS,
    fakturarader: FAKTURARADER,
    summering: SUMMERING,
    tidsspecifikation: TIDSSPECIFIKATION,
    utlaggsspecifikation: UTLAGGSSPECIFIKATION,
    specifikation: SPECIFIKATION,
  },
};
