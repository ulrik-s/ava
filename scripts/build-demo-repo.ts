/**
 * `build-demo-repo` — skapar en lokal mapp som är redo att pushas
 * som ett demo-repo på GitHub.
 *
 * Användning:
 *
 *     yarn tsx scripts/build-demo-repo.ts --dir ./demo-repo
 *     cd demo-repo
 *     git init && git add -A && git commit -m "Demo data"
 *     gh repo create ava-demo --public --source=. --push
 *
 * Sedan kan vem som helst ladda demon i AVA-webappen genom att klistra
 * in GitHub-url:en.
 *
 * Resultatet:
 *   demo-repo/
 *   ├── matters/active/<id>.json    (3 demo-ärenden)
 *   ├── contacts/<id>.json          (5 demo-kontakter)
 *   └── .ava/users/<email>.json     (2 demo-användare)
 *
 * Designval: deterministisk seed-data. Inga sekretessbelagda data —
 * fiktiva svenska namn + fall.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";

interface DemoData {
  matters: Array<{ path: string; data: unknown }>;
  contacts: Array<{ path: string; data: unknown }>;
  users: Array<{ path: string; data: unknown }>;
}

function buildDemoData(): DemoData {
  const orgId = "demo-firma-ab";
  return {
    matters: [
      {
        path: "matters/active/m-vardnad.json",
        data: {
          id: "m-vardnad",
          matterNumber: "2026-0001",
          title: "Vårdnadstvist Andersson / Persson",
          status: "ACTIVE",
          organizationId: orgId,
          notes: "Möte med klient den 14 maj. Genomgång av handlingar och första kontakt med motpart inplanerat.",
        },
      },
      {
        path: "matters/active/m-bostadsratt.json",
        data: {
          id: "m-bostadsratt",
          matterNumber: "2026-0002",
          title: "Bostadsrätt – tvist med BRF Vinkeln",
          status: "ACTIVE",
          organizationId: orgId,
          notes: "Klient har fått överklagat avslag på reparationsanspråk. Granskar stadgar och brf-stämmoprotokoll.",
        },
      },
      {
        path: "matters/active/m-arvskifte.json",
        data: {
          id: "m-arvskifte",
          matterNumber: "2026-0003",
          title: "Arvskifte efter Eriksson",
          status: "CLOSED",
          organizationId: orgId,
          notes: "Bouppteckning klar. Arvskifte registrerat hos Skatteverket.",
        },
      },
    ],
    contacts: [
      {
        path: "contacts/c-andersson.json",
        data: { id: "c-andersson", name: "Anna Andersson", contactType: "PERSON", personalNumber: "19851012-1234", email: "anna.andersson@example.se", organizationId: orgId },
      },
      {
        path: "contacts/c-persson.json",
        data: { id: "c-persson", name: "Björn Persson", contactType: "PERSON", personalNumber: "19831102-5678", email: "bjorn.persson@example.se", organizationId: orgId },
      },
      {
        path: "contacts/c-brf-vinkeln.json",
        data: { id: "c-brf-vinkeln", name: "BRF Vinkeln", contactType: "ORGANIZATION", orgNumber: "716123-4567", email: "styrelsen@vinkeln.se", organizationId: orgId },
      },
      {
        path: "contacts/c-erikssons.json",
        data: { id: "c-erikssons", name: "Familjen Eriksson", contactType: "ORGANIZATION", email: "familjen@eriksson.example.se", organizationId: orgId },
      },
      {
        path: "contacts/c-eriksson-arvinge.json",
        data: { id: "c-eriksson-arvinge", name: "Klas Eriksson", contactType: "PERSON", personalNumber: "19601215-7890", organizationId: orgId },
      },
    ],
    users: [
      {
        path: ".ava/users/anna@demo-firma.se.json",
        data: { id: "u-anna", email: "anna@demo-firma.se", name: "Anna Advokat", role: "LAWYER", sshPublicKeys: [], organizationId: orgId },
      },
      {
        path: ".ava/users/bjorn@demo-firma.se.json",
        data: { id: "u-bjorn", email: "bjorn@demo-firma.se", name: "Björn Biträde", role: "ASSISTANT", sshPublicKeys: [], organizationId: orgId },
      },
    ],
  };
}

async function writeAll(root: string, data: DemoData): Promise<number> {
  let count = 0;
  for (const entry of [...data.matters, ...data.contacts, ...data.users]) {
    const fullPath = resolve(root, entry.path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, JSON.stringify(entry.data, null, 2));
    count++;
  }
  return count;
}

async function main(): Promise<void> {
  const dirArg = process.argv.indexOf("--dir");
  if (dirArg < 0 || !process.argv[dirArg + 1]) {
    console.error("Användning: yarn tsx scripts/build-demo-repo.ts --dir <path>");
    process.exit(1);
  }
  const dir = resolve(process.argv[dirArg + 1]);
  console.log(`▶ Bygger demo-repo i ${dir}`);

  await mkdir(dir, { recursive: true });
  const data = buildDemoData();
  const count = await writeAll(dir, data);

  // README som syns på GitHub-repo-sidan
  await writeFile(resolve(dir, "README.md"), `# AVA Demo Data

Det här är ett demo-repo med fiktiv data för att visa upp AVA i en
webbläsare utan att behöva sätta upp en server.

## Använda

I AVA-demo-läget, ange den här repo-url:en (HTTPS) och klicka "Ladda demo".

## Innehåll

- ${data.matters.length} ärenden (matters/active/)
- ${data.contacts.length} kontakter (contacts/)
- ${data.users.length} användare (.ava/users/)

Alla namn och personnummer är fiktiva.
`);

  // .gitignore för att hålla repo:t rent
  await writeFile(resolve(dir, ".gitignore"), `# Ignorera klient-cache som inte ska deelas
.ava/cache.db
`);

  console.log(`  ✓ ${count} entiteter skrivna`);
  console.log(`\nNästa steg:`);
  console.log(`  cd ${dir}`);
  console.log(`  git init && git add -A && git commit -m 'Demo data'`);
  console.log(`  gh repo create ava-demo --public --source=. --push`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { buildDemoData, writeAll };
