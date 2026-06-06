/**
 * `kostnadsrakning-template` — default Handlebars-mall för
 * kostnadsräkning till rätten.
 *
 * Byrå-användare kan ersätta den genom att skapa en `documentTemplate`
 * med `category: "Kostnadsräkning"` — modal:en plockar den med högst
 * `updatedAt` och faller tillbaka på denna default om ingen finns.
 *
 * Mallen är ren HTML med Handlebars-variabler. Variablerna kommer från
 * `buildKostnadsrakningContext().templateContext`. UI-renderingen sker
 * client-side; browserns print-dialog (`window.print()`) konverterar
 * till PDF/utskrift — fungerar på Mac, PC, telefon och padda utan
 * extra deps.
 */

export const KOSTNADSRAKNING_TEMPLATE_NAME = "Kostnadsräkning till rätten";
export const KOSTNADSRAKNING_TEMPLATE_CATEGORY = "Kostnadsräkning";
/** @public — del av den symmetriska mall-namn/kategori-uppsättningen (NAME-varianten ännu ej konsumerad). */
export const KOSTNADSRAKNING_ICKE_TAXA_TEMPLATE_NAME = "Kostnadsräkning (icke-taxa)";
export const KOSTNADSRAKNING_ICKE_TAXA_TEMPLATE_CATEGORY = "Kostnadsräkning (icke-taxa)";

/** Välj rätt template-kategori baserat på taxa-läget. Används av modal:en
 *  som först letar efter byråns egen mall i den kategorin, sedan faller
 *  tillbaka på default-HTML:en för respektive variant. */
export function templateCategoryFor(isTaxe: boolean): string {
  return isTaxe ? KOSTNADSRAKNING_TEMPLATE_CATEGORY : KOSTNADSRAKNING_ICKE_TAXA_TEMPLATE_CATEGORY;
}

export function defaultTemplateFor(isTaxe: boolean): string {
  return isTaxe ? KOSTNADSRAKNING_DEFAULT_HTML : KOSTNADSRAKNING_ICKE_TAXA_DEFAULT_HTML;
}

export const KOSTNADSRAKNING_DEFAULT_HTML = `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="utf-8">
<title>Kostnadsräkning {{matterNumber}}</title>
<style>
  @page { margin: 24mm 18mm 18mm; size: A4; }
  body { font-family: Helvetica, Arial, sans-serif; font-size: 11pt; color: #111; margin: 0; }
  h1 { font-size: 18pt; margin: 0 0 4pt; letter-spacing: 0.5pt; }
  h2 { font-size: 12pt; margin: 18pt 0 6pt; border-bottom: 1px solid #bbb; padding-bottom: 2pt; }
  .meta { color: #555; font-size: 10pt; }
  .meta strong { color: #111; }
  .totalsRow { display: flex; justify-content: space-between; padding: 4pt 0; }
  .totalsRow.grand { font-size: 13pt; font-weight: 700; border-top: 2px solid #111; margin-top: 8pt; padding-top: 8pt; }
  table { width: 100%; border-collapse: collapse; font-size: 10pt; }
  th { text-align: left; border-bottom: 1px solid #aaa; padding: 4pt 6pt; font-weight: 600; }
  td { padding: 3pt 6pt; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tbody tr + tr td { border-top: 1px solid #eee; }
  tfoot td { font-weight: 700; border-top: 1px solid #aaa; padding-top: 6pt; }
  .footer { margin-top: 32pt; color: #666; font-size: 9pt; }
  .warn { background: #fff7e6; border: 1px solid #f0c574; padding: 6pt 10pt; border-radius: 4pt; margin: 8pt 0; font-size: 10pt; color: #8a5a00; }
  @media print { .noprint { display: none !important; } }
  .noprint { background: #eef; padding: 8pt; text-align: center; font-size: 9pt; color: #335; border-bottom: 1px solid #aac; }
</style>
</head>
<body>

<div class="noprint">
  📋 Kostnadsräkning genererad av AVA. Skriv ut till PDF (Cmd/Ctrl + P → Spara som PDF) och attacha i mailet till rätten.
</div>

<h1>KOSTNADSRÄKNING</h1>
<div class="meta">
  Mål <strong>{{matterNumber}}</strong> — {{matterTitle}}<br>
  {{#if clientName}}Klient: <strong>{{clientName}}</strong><br>{{/if}}
  {{#if courtName}}Domstol: <strong>{{courtName}}</strong><br>{{/if}}
  Datum: <strong>{{today}}</strong>
</div>

<h2>Huvudförhandling</h2>
<div>
  Start: <strong>{{hufStart}}</strong> · Slut: <strong>{{hufEnd}}</strong> ·
  Tid: <strong>{{huvudforhandlingFormatted}}</strong>
</div>

<h2>Arvode — Brottmålstaxa (DVFS 2025:6, nivå {{taxaLevel}})</h2>
{{#if taxaApplies}}
  <div class="totalsRow">
    <span>Brottmålstaxa, intervall {{taxaIntervalLabel}}</span>
    <span class="num">{{arvodeExclFormatted}}</span>
  </div>
  <div class="totalsRow">
    <span>+ Moms 25 %</span>
    <span class="num">{{arvodeMomsFormatted}}</span>
  </div>
  <div class="totalsRow" style="border-top: 1px solid #aaa; padding-top: 6pt; font-weight: 600;">
    <span>Arvode inkl moms</span>
    <span class="num">{{arvodeInclFormatted}}</span>
  </div>
{{else}}
  <div class="warn">
    Förhandlingstiden överstiger taxans maxgräns (3 tim 45 min).
    Ersättning beräknas enligt timkostnadsnorm × faktisk tid (DVFS 2025:6 § 8).
  </div>
{{/if}}

{{#if expenseLines.length}}
<h2>Utlägg</h2>
<table>
  <thead>
    <tr>
      <th>Datum</th>
      <th>Beskrivning</th>
      <th class="num">Moms</th>
      <th class="num">Exkl moms</th>
      <th class="num">Moms</th>
      <th class="num">Inkl moms</th>
    </tr>
  </thead>
  <tbody>
    {{#each expenseLines}}
    <tr>
      <td>{{date}}</td>
      <td>{{description}}</td>
      <td class="num">{{vatRateLabel}}</td>
      <td class="num">{{exclVatFormatted}}</td>
      <td class="num">{{vatFormatted}}</td>
      <td class="num">{{inclVatFormatted}}</td>
    </tr>
    {{/each}}
  </tbody>
  <tfoot>
    <tr>
      <td colspan="3">Summa</td>
      <td class="num">{{expenseSummary.exclVatFormatted}}</td>
      <td class="num">{{expenseSummary.vatFormatted}}</td>
      <td class="num">{{expenseSummary.inclVatFormatted}}</td>
    </tr>
  </tfoot>
</table>
{{/if}}

<div class="totalsRow grand">
  <span>TOTALT ATT FAKTURERA STATEN</span>
  <span class="num">{{totalInclFormatted}}</span>
</div>

<div class="footer">
  <strong>{{defenderName}}</strong>
  {{#if organizationName}} · {{organizationName}}{{/if}}
  {{#if organizationOrgNumber}} · Org.nr {{organizationOrgNumber}}{{/if}}
  {{#if organizationAddress}}<br>{{organizationAddress}}{{/if}}
</div>

</body>
</html>`;

/**
 * Mall för icke-taxa-kostnadsräkning. Visar specifikation av all billable
 * tid + HUF som multipliceras med timkostnadsnorm (1626 kr/h med F-skatt).
 * Ingen taxa-tabell — det är fri timdebitering enligt timkostnadsnorm.
 */
export const KOSTNADSRAKNING_ICKE_TAXA_DEFAULT_HTML = `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="utf-8">
<title>Kostnadsräkning {{matterNumber}}</title>
<style>
  @page { margin: 24mm 18mm 18mm; size: A4; }
  body { font-family: Helvetica, Arial, sans-serif; font-size: 11pt; color: #111; margin: 0; }
  h1 { font-size: 18pt; margin: 0 0 4pt; letter-spacing: 0.5pt; }
  h2 { font-size: 12pt; margin: 18pt 0 6pt; border-bottom: 1px solid #bbb; padding-bottom: 2pt; }
  .meta { color: #555; font-size: 10pt; }
  .meta strong { color: #111; }
  .totalsRow { display: flex; justify-content: space-between; padding: 4pt 0; }
  .totalsRow.grand { font-size: 13pt; font-weight: 700; border-top: 2px solid #111; margin-top: 8pt; padding-top: 8pt; }
  table { width: 100%; border-collapse: collapse; font-size: 10pt; }
  th { text-align: left; border-bottom: 1px solid #aaa; padding: 4pt 6pt; font-weight: 600; }
  td { padding: 3pt 6pt; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tbody tr + tr td { border-top: 1px solid #eee; }
  tfoot td { font-weight: 700; border-top: 1px solid #aaa; padding-top: 6pt; }
  .footer { margin-top: 32pt; color: #666; font-size: 9pt; }
  .note { background: #f0f7ff; border: 1px solid #b8d4f0; padding: 6pt 10pt; border-radius: 4pt; margin: 8pt 0; font-size: 10pt; color: #1e4a7a; }
  @media print { .noprint { display: none !important; } }
  .noprint { background: #eef; padding: 8pt; text-align: center; font-size: 9pt; color: #335; border-bottom: 1px solid #aac; }
</style>
</head>
<body>

<div class="noprint">
  📋 Kostnadsräkning (icke-taxa) genererad av AVA. Skriv ut till PDF (Cmd/Ctrl + P → Spara som PDF) och attacha i mailet till rätten.
</div>

<h1>KOSTNADSRÄKNING</h1>
<div class="meta">
  Mål <strong>{{matterNumber}}</strong> — {{matterTitle}}<br>
  {{#if clientName}}Klient: <strong>{{clientName}}</strong><br>{{/if}}
  {{#if courtName}}Domstol: <strong>{{courtName}}</strong><br>{{/if}}
  Datum: <strong>{{today}}</strong>
</div>

<h2>Huvudförhandling</h2>
<div>
  Start: <strong>{{hufStart}}</strong> · Slut: <strong>{{hufEnd}}</strong> ·
  Tid: <strong>{{huvudforhandlingFormatted}}</strong>
</div>

{{#if timeLines.length}}
<h2>Tidsspecifikation</h2>
<table>
  <thead>
    <tr>
      <th>Datum</th>
      <th>Beskrivning</th>
      <th class="num">Tid</th>
    </tr>
  </thead>
  <tbody>
    {{#each timeLines}}
    <tr>
      <td>{{date}}</td>
      <td>{{description}}</td>
      <td class="num">{{minutesFormatted}}</td>
    </tr>
    {{/each}}
  </tbody>
  <tfoot>
    <tr>
      <td colspan="2">Summa registrerad tid</td>
      <td class="num">{{billableArbetsFormatted}}</td>
    </tr>
    <tr>
      <td colspan="2">+ Huvudförhandling</td>
      <td class="num">{{huvudforhandlingFormatted}}</td>
    </tr>
    <tr>
      <td colspan="2"><strong>Total arbetstid</strong></td>
      <td class="num"><strong>{{totalArbetsFormatted}}</strong></td>
    </tr>
  </tfoot>
</table>
{{/if}}

<h2>Arvode — Timkostnadsnorm (icke-taxa)</h2>
<div class="note">
  Brottmålstaxan är inte tillämplig — ersättning enligt timkostnadsnorm
  × faktiskt nedlagd tid (DVFS 2025:6 § 8 + RB 21:10).
</div>
<div class="totalsRow">
  <span>Arbetstid <strong>{{totalArbetsFormatted}}</strong> × timkostnadsnorm (1 626 kr/h)</span>
  <span class="num">{{arvodeExclFormatted}}</span>
</div>
<div class="totalsRow">
  <span>+ Moms 25 %</span>
  <span class="num">{{arvodeMomsFormatted}}</span>
</div>
<div class="totalsRow" style="border-top: 1px solid #aaa; padding-top: 6pt; font-weight: 600;">
  <span>Arvode inkl moms</span>
  <span class="num">{{arvodeInclFormatted}}</span>
</div>

{{#if expenseLines.length}}
<h2>Utlägg</h2>
<table>
  <thead>
    <tr>
      <th>Datum</th>
      <th>Beskrivning</th>
      <th class="num">Moms</th>
      <th class="num">Exkl moms</th>
      <th class="num">Moms</th>
      <th class="num">Inkl moms</th>
    </tr>
  </thead>
  <tbody>
    {{#each expenseLines}}
    <tr>
      <td>{{date}}</td>
      <td>{{description}}</td>
      <td class="num">{{vatRateLabel}}</td>
      <td class="num">{{exclVatFormatted}}</td>
      <td class="num">{{vatFormatted}}</td>
      <td class="num">{{inclVatFormatted}}</td>
    </tr>
    {{/each}}
  </tbody>
  <tfoot>
    <tr>
      <td colspan="3">Summa</td>
      <td class="num">{{expenseSummary.exclVatFormatted}}</td>
      <td class="num">{{expenseSummary.vatFormatted}}</td>
      <td class="num">{{expenseSummary.inclVatFormatted}}</td>
    </tr>
  </tfoot>
</table>
{{/if}}

<div class="totalsRow grand">
  <span>TOTALT ATT FAKTURERA STATEN</span>
  <span class="num">{{totalInclFormatted}}</span>
</div>

<div class="footer">
  <strong>{{defenderName}}</strong>
  {{#if organizationName}} · {{organizationName}}{{/if}}
  {{#if organizationOrgNumber}} · Org.nr {{organizationOrgNumber}}{{/if}}
  {{#if organizationAddress}}<br>{{organizationAddress}}{{/if}}
</div>

</body>
</html>`;
