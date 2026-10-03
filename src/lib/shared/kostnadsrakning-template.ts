/**
 * `kostnadsrakning-template` — default Handlebars-mall för
 * kostnadsräkning till rätten.
 *
 * Byrå-användare kan ersätta den genom att skapa en `documentTemplate`
 * med `category: "Kostnadsräkning"` — modal:en plockar den med högst
 * `updatedAt` och faller tillbaka på denna default om ingen finns.
 *
 * Mallen är ren HTML med Handlebars-variabler ur
 * `buildKostnadsrakningContext().templateContext`. Default-mallen ritar ur
 * dokumentvyn `document` (#1218) — samma vy som PDF-renderaren använder — och
 * följer byråns kostnadsräkningar: sida 1 = sammanställning, sida 2+ =
 * arbetsredogörelse med "Sida N" nederst. De platta fälten (`arvodeExclFormatted`,
 * `timeLines` …) finns kvar för byråernas egna mallar.
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

/** Default-mallen för en kategori. Sedan #1218 delar taxe- och löpande
 *  ärenden samma layout — vad arvodet står på avgörs av contexten. Parametern
 *  finns kvar för kategorisymmetrin med `templateCategoryFor`. */
export function defaultTemplateFor(_isTaxe: boolean): string {
  return KOSTNADSRAKNING_DEFAULT_HTML;
}

/**
 * Default-mallen. En och samma layout för taxe- och löpande ärenden: vad
 * arvodet står på (brottmålstaxa, förordnandetaxa, timkostnadsnorm) avgörs
 * redan i dokumentvyns sammanställningsrader och noter.
 */
export const KOSTNADSRAKNING_DEFAULT_HTML = `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="utf-8">
<title>Kostnadsräkning {{matterNumber}}</title>
<style>
  @page { size: A4; margin: 20mm 22mm 22mm 25mm; @bottom-center { content: "Sida " counter(page); font: 11pt "Times New Roman", Times, serif; } }
  @page :first { @bottom-center { content: none; } }
  body { font-family: "Times New Roman", Times, serif; font-size: 12pt; color: #000; margin: 0; line-height: 1.35; }
  .page1 { min-height: 250mm; display: flex; flex-direction: column; }
  .letterhead { text-align: center; font-size: 18pt; letter-spacing: 1pt; margin: 6mm 0 12mm; }
  .letterhead img { max-width: 72mm; max-height: 34mm; }
  .recipient { margin-left: 55%; margin-bottom: 12mm; }
  .title { font-weight: 700; }
  .meta p { margin: 0 0 4pt; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 3pt 0; vertical-align: top; font-weight: 400; }
  .num { text-align: right; white-space: nowrap; }
  .summary { margin-top: 12mm; }
  .summary th { color: #7f7f7f; font-style: italic; text-align: left; }
  .summary th.num { text-align: right; }
  .summary td { padding: 5pt 0; }
  .summary .gap td { padding-top: 22pt; }
  .summary .grand td { font-weight: 700; border-bottom: 2.5pt solid #000; }
  .notes { font-size: 10pt; margin-top: 6pt; }
  .notes p { margin: 0 0 3pt; }
  .radgivning { margin: 14pt 0 0; }
  .placedate { margin: 16pt 0 16pt; }
  .signature p { margin: 0; }
  .footer { position: relative; margin-top: auto; border-top: 1px solid #bfbfbf; padding-top: 8pt; text-align: center; font-family: Calibri, Helvetica, Arial, sans-serif; font-size: 8pt; line-height: 1.3; }
  .footer .seal { position: absolute; left: 0; top: 6pt; max-width: 28mm; max-height: 15mm; }
  .spec { break-before: page; font-size: 11pt; }
  .spec h1 { font-size: 12pt; margin: 18mm 0 0; padding-bottom: 12pt; border-bottom: 1px solid #000; }
  .spec h2 { font-size: 11pt; text-decoration: underline; margin: 22pt 0 4pt 3pt; }
  .spec td { padding: 1pt 0 2pt; }
  .spec td.date { width: 30%; padding-left: 3pt; }
  .spec .sum td { font-weight: 700; padding-left: 0; }
  .spec td.qty { width: 7%; }
  @media print { .noprint { display: none !important; } }
  .noprint { background: #eef; padding: 8pt; text-align: center; font: 9pt Helvetica, Arial, sans-serif; color: #335; border-bottom: 1px solid #aac; }
</style>
</head>
<body>

<div class="noprint">
  Kostnadsräkning genererad av AVA. Skriv ut till PDF (Cmd/Ctrl + P → Spara som PDF) och bifoga i mailet till rätten.
</div>

{{#with document}}
<section class="page1">
  {{#if logo}}<div class="letterhead"><img src="{{logo}}" alt="{{firmName}}"></div>
  {{else}}{{#if firmName}}<div class="letterhead">{{firmName}}</div>{{/if}}{{/if}}

  {{#if recipient}}
  <div class="recipient">{{recipient}}<br>via e-post</div>
  {{/if}}

  <div class="meta">
    <p class="title">{{title}}</p>
    <p>Faktura-/ärendenr: <strong>{{paymentReference}} Anges vid betalning</strong></p>
    {{#if bankgiro}}<p>Bankgiro: {{bankgiro}}</p>{{/if}}
  </div>

  <table class="summary">
    <thead><tr><th>Enligt bifogad specifikation</th><th class="num">tid/antal</th><th class="num">kr</th></tr></thead>
    <tbody>
      {{#each summaryRows}}
      <tr><td>{{label}}</td><td class="num">{{quantity}}</td><td class="num">{{amount}}</td></tr>
      {{/each}}
      <tr class="gap"><td>Belopp exkl. moms</td><td></td><td class="num">{{totals.exclVat}}</td></tr>
      <tr class="gap"><td>{{totals.vatLabel}}</td><td></td><td class="num">{{totals.vat}}</td></tr>
      <tr class="grand"><td>Belopp inkl. moms</td><td></td><td class="num">{{totals.inclVat}}</td></tr>
    </tbody>
  </table>

  {{#if notes.length}}
  <div class="notes">{{#each notes}}<p>{{this}}</p>{{/each}}</div>
  {{/if}}

  {{#if radgivningNotice}}
  <p class="radgivning">{{radgivningNotice}}</p>
  {{/if}}

  <p class="placedate">{{placeDate}}</p>
  <div class="signature">
    <p>{{signatureName}}</p>
    {{#if signatureTitle}}<p>{{signatureTitle}}</p>{{/if}}
  </div>

  {{#if footerLines.length}}
  <div class="footer">
    {{#if footerSeal}}<img class="seal" src="{{footerSeal}}" alt="">{{/if}}
    {{#each footerLines}}<div>{{#each this}}{{#unless @first}} · {{/unless}}{{this}}{{/each}}</div>{{/each}}
  </div>
  {{/if}}
</section>

{{#if hasSpecification}}
<section class="spec">
  <h1>ARBETSREDOGÖRELSE</h1>

  {{#each specSections}}
  <h2>{{heading}}</h2>
  <table>
    <tbody>
      {{#each rows}}
      <tr><td class="date">{{date}}</td><td>{{description}}</td><td class="num">{{quantity}}</td></tr>
      {{/each}}
      <tr class="sum"><td>Summa</td><td></td><td class="num">{{sum}}</td></tr>
    </tbody>
  </table>
  {{/each}}

  {{#if expenseSpec}}
  <h2>Utlägg</h2>
  <table>
    <tbody>
      {{#each expenseSpec.rows}}
      <tr><td class="date">{{date}}</td><td>{{description}}</td><td class="num qty">{{quantity}}</td><td class="num qty">{{unitPrice}}</td><td class="num qty">{{amount}}</td></tr>
      {{/each}}
      <tr class="sum"><td>Summa</td><td></td><td></td><td></td><td class="num">{{expenseSpec.sum}}</td></tr>
    </tbody>
  </table>
  {{/if}}
</section>
{{/if}}
{{/with}}

</body>
</html>`;
