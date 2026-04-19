/**
 * Seed script: inserts example document templates.
 *
 * Run with:
 *   npx tsx scripts/seed-templates.ts
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

// ─── Template definitions ────────────────────────────────────────

const templates = [
  // ── 1. Uppdragsavtal ──────────────────────────────────────────
  {
    name: "Uppdragsavtal",
    category: "Avtal",
    description: "Standardmall för uppdragsavtal med klient",
    content: `<h1>Uppdragsavtal</h1>

<table style="width:100%;margin-bottom:1.5em;font-size:11pt">
  <tr>
    <td style="width:50%;vertical-align:top">
      <strong>Uppdragsgivare</strong><br>
      {{klient.name}}<br>
      {{#if klient.personalNumber}}Personnr: {{klient.personalNumber}}<br>{{/if}}
      {{#if klient.address}}{{klient.address}}<br>{{/if}}
      {{#if klient.phone}}Tel: {{klient.phone}}<br>{{/if}}
      {{#if klient.email}}{{klient.email}}{{/if}}
    </td>
    <td style="width:50%;vertical-align:top">
      <strong>Uppdragstagare</strong><br>
      {{organization.name}}<br>
      {{#if organization.orgNumber}}Org.nr: {{organization.orgNumber}}<br>{{/if}}
      {{#if organization.address}}{{organization.address}}<br>{{/if}}
      {{#if organization.phone}}Tel: {{organization.phone}}<br>{{/if}}
      {{#if organization.email}}{{organization.email}}{{/if}}
    </td>
  </tr>
</table>

<h2>1. Uppdrag</h2>
<p>
  {{organization.name}} (nedan "Byrån") åtar sig att biträda
  {{klient.name}} (nedan "Klienten") i ärendet:
</p>
<p>
  <strong>Ärende:</strong> {{matter.matterNumber}} – {{matter.title}}<br>
  {{#if matter.matterType}}<strong>Ärendetyp:</strong> {{matter.matterType}}<br>{{/if}}
  {{#if matter.description}}<strong>Beskrivning:</strong> {{matter.description}}{{/if}}
</p>

<h2>2. Arvode</h2>
<p>
  Arvodet debiteras efter nedlagd tid. Aktuell timkostnad meddelas separat
  och kan komma att justeras med hänsyn till ärendets art och komplexitet.
  Utlägg och kostnader som uppstår i ärendets handläggning debiteras
  utöver arvodet.
</p>

<h2>3. Fakturering</h2>
<p>
  Faktura utställs månadsvis eller när uppdraget avslutas.
  Betalningsvillkor 20 dagar netto. Vid försenad betalning utgår
  dröjsmålsränta enligt räntelagen.
</p>

<h2>4. Sekretess</h2>
<p>
  Byrån är underkastad de regler om tystnadsplikt som gäller för
  advokater och biträdande jurister. Uppgifter om Klientens angelägenheter
  lämnas inte ut till utomstående utan Klientens samtycke, om inte
  lag eller domstolsbeslut föreskriver annat.
</p>

<h2>5. Personuppgifter</h2>
<p>
  Personuppgifter behandlas i enlighet med GDPR och Byråns
  integritetspolicy, vilken finns tillgänglig på begäran.
</p>

<h2>6. Klagomål</h2>
<p>
  Klagomål på Byråns tjänster hanteras i första hand av den
  ansvarige advokaten. Om klagomålet inte kan lösas internt kan det
  anmälas till Advokatsamfundets disciplinnämnd.
</p>

<div class="signature-block">
  <p>Ort och datum: ________________________, {{today}}</p>

  <table style="width:100%;margin-top:2em">
    <tr>
      <td style="width:45%">
        <div class="signature-line">{{klient.name}}<br><em>Klient</em></div>
      </td>
      <td style="width:10%"></td>
      <td style="width:45%">
        <div class="signature-line">{{generatedBy.name}}<br><em>{{generatedBy.title}}, {{organization.name}}</em></div>
      </td>
    </tr>
  </table>
</div>`,
  },

  // ── 2. Fullmakt ───────────────────────────────────────────────
  {
    name: "Fullmakt",
    category: "Avtal",
    description: "Fullmakt för ombud att företräda klient",
    content: `<h1>Fullmakt</h1>

<p>
  Undertecknad, <strong>{{klient.name}}</strong>
  {{#if klient.personalNumber}}(personnr {{klient.personalNumber}}){{/if}},
  {{#if klient.address}}bosatt på {{klient.address}},{{/if}}
  ger härmed
</p>

<p style="text-align:center;font-size:14pt;margin:1em 0">
  <strong>{{generatedBy.name}}</strong><br>
  <em>{{generatedBy.title}}</em><br>
  {{organization.name}}
</p>

<p>
  fullmakt att i mitt namn och för min räkning företräda mig i
  {{#if matter.matterType}}ärende avseende {{matter.matterType}}: {{/if}}<strong>{{matter.title}}</strong>
  (ärende {{matter.matterNumber}}).
</p>

<h2>Befogenheter</h2>
<p>Fullmäktigen äger rätt att:</p>
<ul>
  <li>föra min talan inför domstol och myndighet</li>
  <li>ingå förlikning och träffa uppgörelser</li>
  <li>ta emot delgivningar</li>
  <li>vidta alla åtgärder som ärendets handläggning kräver</li>
</ul>

{{#if motpart}}
<h2>Motpart</h2>
<p>{{motpart.name}}{{#if motpart.personalNumber}} (personnr {{motpart.personalNumber}}){{/if}}</p>
{{/if}}

<div class="signature-block">
  <p>Ort och datum: ________________________, {{today}}</p>

  <div class="signature-line" style="margin-top:2em">
    {{klient.name}}<br>
    <em>Fullmaktsgivare</em>
  </div>
</div>`,
  },

  // ── 3. Tidrapport ─────────────────────────────────────────────
  {
    name: "Tidrapport",
    category: "Rapporter",
    description: "Specifikation av nedlagd tid per ärende",
    content: `<h1>Tidrapport</h1>

<table style="width:100%;margin-bottom:1.5em;font-size:11pt">
  <tr>
    <td><strong>Ärende:</strong> {{matter.matterNumber}} – {{matter.title}}</td>
    <td style="text-align:right"><strong>Datum:</strong> {{today}}</td>
  </tr>
  {{#if klient}}
  <tr>
    <td><strong>Klient:</strong> {{klient.name}}</td>
    <td></td>
  </tr>
  {{/if}}
</table>

<h2>Tidposter</h2>
{{#if timeEntries}}
<table>
  <thead>
    <tr>
      <th style="width:12%">Datum</th>
      <th style="width:38%">Beskrivning</th>
      <th style="width:15%">Tid</th>
      <th style="width:20%">Advokat</th>
      <th style="width:15%;text-align:right">Debiteras</th>
    </tr>
  </thead>
  <tbody>
    {{#each timeEntries}}
    <tr>
      <td>{{formatDateShort date}}</td>
      <td>{{description}}</td>
      <td>{{hours}}</td>
      <td>{{userName}}</td>
      <td style="text-align:right">{{#if billable}}{{formatAmount amount}}{{else}}<em>Ej deb.</em>{{/if}}</td>
    </tr>
    {{/each}}
  </tbody>
  <tfoot>
    <tr style="font-weight:bold;border-top:2px solid #333">
      <td colspan="2">Summa</td>
      <td>{{formatHours totalTimeMinutes}}</td>
      <td></td>
      <td style="text-align:right">{{formatAmount totalTimeAmount}}</td>
    </tr>
  </tfoot>
</table>
{{else}}
<p><em>Inga tidposter registrerade för detta ärende.</em></p>
{{/if}}

{{#if expenses}}
<h2>Utlägg</h2>
<table>
  <thead>
    <tr>
      <th style="width:12%">Datum</th>
      <th style="width:53%">Beskrivning</th>
      <th style="width:20%">Utfört av</th>
      <th style="width:15%;text-align:right">Belopp</th>
    </tr>
  </thead>
  <tbody>
    {{#each expenses}}
    <tr>
      <td>{{formatDateShort date}}</td>
      <td>{{description}}</td>
      <td>{{userName}}</td>
      <td style="text-align:right">{{#if billable}}{{formatAmount amount}}{{else}}<em>Ej deb.</em>{{/if}}</td>
    </tr>
    {{/each}}
  </tbody>
  <tfoot>
    <tr style="font-weight:bold;border-top:2px solid #333">
      <td colspan="3">Totalt utlägg</td>
      <td style="text-align:right">{{formatAmount totalExpenseAmount}}</td>
    </tr>
  </tfoot>
</table>
{{/if}}

<table style="margin-top:1.5em;font-size:11pt;width:auto;margin-left:auto">
  <tr>
    <td style="padding-right:2em"><strong>Total tid:</strong></td>
    <td>{{formatHours totalTimeMinutes}}</td>
  </tr>
  <tr>
    <td><strong>Arvode (debiterbart):</strong></td>
    <td>{{formatAmount totalTimeAmount}}</td>
  </tr>
  {{#if totalExpenseAmount}}
  <tr>
    <td><strong>Utlägg (debiterbart):</strong></td>
    <td>{{formatAmount totalExpenseAmount}}</td>
  </tr>
  {{/if}}
</table>

<p style="margin-top:1em;font-size:10pt;color:#666">
  Genererad av {{generatedBy.name}} ({{generatedBy.title}}), {{today}}.
</p>`,
  },

  // ── 4. Kontaktbekräftelse ──────────────────────────────────────
  {
    name: "Kontaktbekräftelse",
    category: "Brev",
    description: "Bekräftelsebrev till ny klient med kontaktuppgifter",
    content: `{{#if klient}}
<p style="text-align:right;font-size:11pt">
  {{today}}
</p>

<p style="font-size:11pt">
  {{klient.name}}<br>
  {{#if klient.address}}{{klient.address}}<br>{{/if}}
  {{#if klient.email}}{{klient.email}}{{/if}}
</p>
{{/if}}

<h1 style="font-size:14pt;margin-top:2em">Bekräftelse av uppdrag – {{matter.matterNumber}}</h1>

<p>
  Tack för att Du anlitar {{organization.name}}.
  Vi bekräftar härmed att vi mottagit Ditt uppdrag avseende
  <strong>{{matter.title}}</strong>{{#if matter.matterType}} ({{matter.matterType}}){{/if}}.
</p>

{{#if matter.description}}
<p>{{matter.description}}</p>
{{/if}}

<p>
  Din kontaktperson hos oss är <strong>{{generatedBy.name}}</strong>
  ({{generatedBy.title}}). Du är välkommen att kontakta oss
  {{#if organization.phone}}per telefon på {{organization.phone}}{{/if}}
  {{#if organization.email}} eller via e-post på {{organization.email}}{{/if}}.
</p>

<h2 style="font-size:12pt">Övriga parter i ärendet</h2>
{{#if contacts}}
<table>
  <thead>
    <tr>
      <th>Namn</th>
      <th>Roll</th>
      <th>E-post</th>
      <th>Telefon</th>
    </tr>
  </thead>
  <tbody>
    {{#each contacts}}
    <tr>
      <td>{{name}}</td>
      <td>{{roleLabel}}</td>
      <td>{{#if email}}{{email}}{{else}}–{{/if}}</td>
      <td>{{#if phone}}{{phone}}{{else}}–{{/if}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>
{{else}}
<p><em>Inga övriga parter registrerade.</em></p>
{{/if}}

<p style="margin-top:2em">
  Med vänliga hälsningar,
</p>

<div class="signature-block">
  <div class="signature-line" style="margin-top:1.5em">
    {{generatedBy.name}}<br>
    <em>{{generatedBy.title}}, {{organization.name}}</em>
  </div>
</div>`,
  },
];

// ─── Seed ────────────────────────────────────────────────────────

async function main() {
  // Find first organisation and admin user
  const org = await prisma.organization.findFirstOrThrow();
  const user = await prisma.user.findFirstOrThrow({
    where: { organizationId: org.id },
  });

  console.log(`\nSeeding templates for org "${org.name}" (id: ${org.id})`);

  let created = 0;
  let skipped = 0;

  for (const tpl of templates) {
    const existing = await prisma.documentTemplate.findFirst({
      where: { name: tpl.name, organizationId: org.id },
    });

    if (existing) {
      console.log(`  SKIP  "${tpl.name}" — already exists`);
      skipped++;
      continue;
    }

    await prisma.documentTemplate.create({
      data: {
        name: tpl.name,
        category: tpl.category,
        description: tpl.description,
        content: tpl.content,
        organizationId: org.id,
        createdById: user.id,
      },
    });
    console.log(`  ✓  "${tpl.name}" (${tpl.category})`);
    created++;
  }

  console.log(`\nDone: ${created} created, ${skipped} skipped.\n`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
