/**
 * Delade partials för dokumentmallarna (ADR 0042) — byggstenar som fakturan
 * använder i dag och som kostnadsräkning, brev och påminnelser ska återanvända.
 * En mall når dem med `{{> namn}}`. Layouten är byråns brevmall (#2255): Times,
 * marginaler 20 mm, sidfoten i sans-serif.
 *
 * - `stilar` — de namngivna stilarna: `dämpad` text, `linje` för tunna streck,
 *   `kolumnrubrik` (kursiv, grå) och `sidfot` (liten sans-serif). Står först i
 *   `<document>`; de andra partialerna förutsätter dem.
 * - `brevhuvud` — byråns logga centrerad överst (byråns namn när loggan
 *   saknas) och mottagarens namn och postadress i fönsterkuvertets läge
 *   (`recipientLines`).
 * - `betalningsuppgifter` — rubriken "<RUBRIK> NR <nummer>", uppmaningen att
 *   bara ange fakturanumret, uppgiftsblocket (klient, fakturadag, förfallodag,
 *   ärendenummer, bankgiro) och dröjsmålsräntan.
 * - `avrakning` — avräkningstabellen Avräkning | Underlag | Andel | Belopp med
 *   totalraden (`settlementRows`, `totalLabel`, `total`).
 * - `sidfot` — på varje sida: tunn linje, sigillet till vänster och byråns
 *   namn, telefon, webbplats, bankgiro, VAT-nummer och F-skatt centrerat.
 *
 * Kontexten följer fakturans vy-modell (`FakturaView`). Byråns uppgifter kommer
 * ur organisationsinställningarna — inget byråspecifikt står i mallen.
 */

const STILAR = `
<style name="dämpad" color="0.45"/>
<style name="linje" color="0.72"/>
<style name="kolumnrubrik" font="italic" color="0.45"/>
<style name="sidfot" font="sans" size="7.5" leading="10" color="0.2"/>
`;

const BREVHUVUD = `
{{#if logo}}
  <block at="top-left" top="30"><image src="logo" width="205" height="80" align="center"/></block>
{{else}}
  <block at="top-left" top="80"><text size="18" align="center">{{organizationName}}</text></block>
{{/if}}
<block at="window">
  {{#each recipientLines}}<text size="11" leading="14">{{this}}</text>{{/each}}
</block>
`;

const BETALNINGSUPPGIFTER = `
<text size="12" font="bold" leading="16">{{upper heading}} NR {{invoiceNumber}}</text>
{{#if payable}}<text size="12" font="bold" leading="16">Ange <u>endast fakturanummer</u> vid betalning tack!</text>{{/if}}
<spacer height="8"/>
<table size="11" repeat-header="false">
  <col width="100"/><col width="*"/>
  {{#if clientName}}<row leading="14"><cell>Klient:</cell><cell>{{clientName}}</cell></row>{{/if}}
  <row leading="14"><cell>Fakturadag:</cell><cell>{{date}}</cell></row>
  {{#if dueDate}}<row leading="14"><cell>Förfallodag:</cell><cell>{{dueDate}}</cell></row>{{/if}}
  <row leading="14"><cell>Vårt ärendenr:</cell><cell>{{matterNumber}}</cell></row>
  {{#if organizationBankgiro}}<row leading="14"><cell>Bankgiro:</cell><cell>{{organizationBankgiro}}</cell></row>{{/if}}
</table>
{{#if payable}}<text size="11" font="italic" leading="15" space-before="5">Efter förfallodagen debiteras dröjsmålsränta enligt 6 § räntelagen</text>{{/if}}
<spacer height="10"/>
`;

const AVRAKNING = `
<table size="10.5" keep-extra="5" repeat-header="true">
  <col width="*" wrap="true"/><col width="95" align="right"/><col width="50" align="right"/><col width="95" align="right"/>
  <thead keep="60">
    <row style="kolumnrubrik" leading="6"><cell>Avräkning</cell><cell>Underlag</cell><cell>Andel</cell><cell>Belopp</cell></row>
    <rule style="linje" space-after="14"/>
  </thead>
  {{#each settlementRows}}
    <row leading="14"{{#if muted}} style="dämpad"{{/if}}><cell>{{label}}</cell><cell>{{basis}}</cell><cell>{{share}}</cell><cell>{{amount}}</cell></row>
  {{/each}}
  <tfoot keep="40">
    <rule style="linje" space-before="-3" space-after="15"/>
    <row font="bold" leading="20"><cell>{{totalLabel}}</cell><cell/><cell/><cell>{{total}}</cell></row>
  </tfoot>
</table>
`;

const SIDFOT = `
<page-footer top="772">
  <rule thickness="0.75" color="0.75"/>
  {{#if footerSeal}}<block x="20mm" top="780" width="80"><image src="seal" width="80" height="42"/></block>{{/if}}
  <spacer height="16"/>
  {{#if organizationName}}<text style="sidfot" align="center">{{organizationName}}</text>{{/if}}
  {{#if organizationPhone}}<text style="sidfot" align="center">Tel: {{organizationPhone}}</text>{{/if}}
  {{#if organizationWebsite}}<text style="sidfot" align="center">{{organizationWebsite}}</text>{{/if}}
  <text style="sidfot" align="center">{{#if organizationBankgiro}}Arvoden bankgiro {{organizationBankgiro}} · {{/if}}{{#if organizationVatNumber}}VAT nr: {{organizationVatNumber}} · {{/if}}Godkänd för F-skatt</text>
</page-footer>
`;

/** De delade partialerna, per namn. */
export const SHARED_PARTIALS: Readonly<Record<string, string>> = {
  stilar: STILAR,
  brevhuvud: BREVHUVUD,
  betalningsuppgifter: BETALNINGSUPPGIFTER,
  avrakning: AVRAKNING,
  sidfot: SIDFOT,
};
