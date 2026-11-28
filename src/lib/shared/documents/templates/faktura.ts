/**
 * Standardmallen för fakturan (ADR 0042) — Handlebars över layoutspråket.
 * Kontexten är `FakturaView` (`buildFakturaView`): allt är färdigformaterat,
 * mallen räknar ingenting.
 *
 *   sida 1  brevhuvud, ärende och betalningsuppgifter, sammanställningen
 *           (benämning | tim | timpris | belopp, med uträkningskedjan och
 *           slutsumman), uppdelningen klient/betalare och "att betala".
 *   sida 2+ specifikationen: tidsspecifikation per arvodeskategori med
 *           delsumma och utläggsspecifikation med summarad.
 *
 * Mallen återger fakturan exakt som den ritades i kod före #2251 (golden-
 * testerna i `test/unit/lib/documents/faktura-golden.test.ts`): sidan är A4
 * avrundat till hela punkter (595 × 842), första baslinjen 42 pt under
 * överkanten och sidan bryts 64 pt ovanför nederkanten.
 */

import type { DocumentTemplateSource } from "../template-source";
import { SHARED_PARTIALS } from "./partials";

const SAMMANSTALLNING = `
<text keep="90" size="13" font="bold" leading="18">Sammanställning</text>
<table keep-extra="5" repeat-header="false">
  <col width="*" wrap="true"/><col width="50" align="right"/><col width="100" align="right"/><col width="95" align="right"/>
  <thead>
    <row size="9" font="bold" leading="5"><cell>Benämning</cell><cell>Tim</cell><cell>Timpris</cell><cell>Belopp</cell></row>
    <rule style="linje" space-after="13"/>
  </thead>
  {{#each summary}}
    {{#if subtotal}}<rule style="linje" keep="30" space-before="-4" space-after="13"/>{{/if}}
    <row leading="15" font="{{#if subtotal}}bold{{else}}regular{{/if}}">
      <cell>{{label}}</cell><cell>{{hours}}</cell><cell>{{rateLabel}}</cell><cell>{{amount}}</cell>
    </row>
  {{/each}}
  <tfoot keep="30">
    <rule style="linje" thickness="1.2" space-before="-3" space-after="15"/>
    <row font="bold" leading="22"><cell>{{summaryTotalLabel}}</cell><cell/><cell/><cell>{{summaryTotal}}</cell></row>
  </tfoot>
</table>
`;

const UPPDELNING = `
{{#if hasSplit}}<text keep="40" size="11" font="bold" leading="16">Uppdelning klient / betalare</text>{{/if}}
<table keep-extra="5" repeat-header="false">
  <col width="*" wrap="true"/><col width="110" align="right"/>
  {{#each splitRows}}
    <row leading="15"{{#if muted}} style="dämpad"{{/if}}><cell>{{label}}</cell><cell>{{amount}}</cell></row>
  {{/each}}
  <tfoot keep="40">
    <rule style="linje" thickness="1.2" space-before="-3" space-after="17"/>
    <row size="12" font="bold" leading="20"><cell>{{totalLabel}}</cell><cell>{{total}}</cell></row>
  </tfoot>
</table>
{{#if footnote}}<text keep="30" size="9" leading="12" style="dämpad">{{footnote}}</text>{{/if}}
`;

/** Specifikationstabellernas gemensamma rubrik- och summaradsstil. */
const SPEC_HEAD_RULE = `<rule style="linje" space-after="13"/>`;
const SPEC_TOTAL_RULE = `<rule style="linje" space-before="2" space-after="11"/>`;

const TIDSSPECIFIKATION = `
{{#if timeGroups}}
<text keep="90" size="11" font="bold" leading="18">Tidsspecifikation</text>
{{#each timeGroups}}
  <text keep="70" font="bold" leading="14">{{label}}</text>
  <table size="9" keep-extra="6" repeat-header="false">
    <col width="66"/><col width="*" wrap="true"/><col width="46" align="right"/>{{#if @root.showTimeAmounts}}<col width="80" align="right"/>{{/if}}
    <thead keep="40">
      <row font="bold" leading="5"><cell>Datum</cell><cell>Beskrivning</cell><cell>Tim</cell>{{#if @root.showTimeAmounts}}<cell>Belopp</cell>{{/if}}</row>
      ${SPEC_HEAD_RULE}
    </thead>
    {{#each lines}}
      <row leading="12" space-after="2">
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
<text keep="60" size="11" font="bold" leading="16">Utläggsspecifikation</text>
<table size="9" keep-extra="6" repeat-header="false">
  <col width="66"/><col width="*" wrap="true"/><col width="46" align="right"/><col width="75" align="right"/>
  <thead keep="40">
    <row font="bold" leading="5"><cell>Datum</cell><cell>Beskrivning</cell><cell>Netto</cell><cell>Brutto</cell></row>
    ${SPEC_HEAD_RULE}
  </thead>
  {{#each expenseLines}}
    <row leading="12" space-after="2"><cell>{{date}}</cell><cell>{{description}}</cell><cell>{{net}}</cell><cell>{{gross}}</cell></row>
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
<text size="9" leading="20" style="dämpad">Underlag till beloppen i sammanställningen ovan.</text>
{{> tidsspecifikation}}
{{> utlaggsspecifikation}}
{{/if}}
`;

const FAKTURA = `
<document width="595" height="842" margin-top="42" margin-right="50" margin-bottom="64" margin-left="50"
          font-family="helvetica" title="{{heading}} {{invoiceNumber}}" subject="Faktura">
{{> stilar}}
{{> brevhuvud rubrik=heading}}
<text size="11" font="bold" leading="16">Ärende {{matterNumber}} — {{matterTitle}}</text>
{{> betalningsuppgifter}}
<spacer height="8"/>
{{> sammanstallning}}
{{> uppdelning}}
{{> specifikation}}
</document>
`;

/** Fakturans standardmall med sina partials (de delade + fakturans egna avsnitt). */
export const STANDARD_FAKTURA_TEMPLATE: DocumentTemplateSource = {
  template: FAKTURA,
  partials: {
    ...SHARED_PARTIALS,
    sammanstallning: SAMMANSTALLNING,
    uppdelning: UPPDELNING,
    tidsspecifikation: TIDSSPECIFIKATION,
    utlaggsspecifikation: UTLAGGSSPECIFIKATION,
    specifikation: SPECIFIKATION,
  },
};
