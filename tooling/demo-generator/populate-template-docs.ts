/**
 * `populateTemplateDocs` — skapar MALL-GENERERADE dokument i ärenden, precis
 * som `GenerateModal` gör i appen: rendera en dokumentmall (Handlebars) med
 * ärendets kontext → HTML-dokument som registreras på ärendet via
 * `document.register` (matterId satt).
 *
 * Visar upp flödet "generera dokument från mall → hamnar i ärendet" i demon.
 * Renderar samma mallar som seedens `documentTemplates` (Fullmakt för alla
 * ärenden; Stämningsansökan för tvister med domstol).
 *
 * Binärinnehållet (HTML) skrivs via `sink` (git → documents/content/<id>.html),
 * samma mönster som populate-documents.
 */

import { renderHandlebars } from "@/lib/client/kostnadsrakning/render-handlebars";
import { buildTemplateContext } from "@/lib/client/templates/build-template-context";
import type { SeedDataset } from "../scripts/seed-data";
import type { GeneratorCaller } from "./backend-target";
import type { BinarySink } from "./populate-documents";

type Row = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCaller = any;

function defined(obj: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

function indexById(rows: Row[]): Map<string, Row> {
  const map = new Map<string, Row>();
  for (const r of rows) map.set(String(r.id), r);
  return map;
}

function klientNameFor(matterId: string, matterContacts: Row[], contacts: Map<string, Row>): string {
  const mc = matterContacts.find((x) => x.matterId === matterId && x.role === "KLIENT");
  return mc ? String(contacts.get(String(mc.contactId))?.name ?? "") : "";
}

async function emitTemplateDoc(c: AnyCaller, sink: BinarySink | undefined, matter: Row, tpl: Row, ctx: Record<string, unknown>): Promise<void> {
  const html = renderHandlebars(String(tpl.content ?? ""), ctx);
  const id = `gendoc-${matter.id}-${tpl.id}`;
  const storagePath = `documents/content/${id}.html`;
  const bytes = new TextEncoder().encode(html);
  const size = sink ? sink(storagePath, bytes) : bytes.byteLength;
  const createdAt = matter.createdAt ? new Date(matter.createdAt as string).toISOString() : undefined;
  await c.document.register(
    defined({
      id, matterId: matter.id,
      fileName: `${String(tpl.name)} ${String(ctx.today)}.html`,
      mimeType: "text/html; charset=utf-8",
      sizeBytes: size,
      storagePath,
      title: `${String(tpl.name)} — ${String(matter.matterNumber)}`,
      documentType: String(tpl.name),
      summary: `Mall-genererat dokument (${String(tpl.name)}) för ärende ${String(matter.matterNumber)}.`,
      analysisStatus: "DONE",
      createdAt,
    }),
  );
}

interface TemplateInputs {
  templates: Row[];
  matters: Row[];
  matterContacts: Row[];
  contacts: Map<string, Row>;
  org: Row;
  userName: string;
}

function templateInputs(seed: SeedDataset): TemplateInputs {
  const arr = (k: keyof SeedDataset) => (seed[k] as Row[] | undefined) ?? [];
  return {
    templates: arr("documentTemplates"),
    matters: arr("matters"),
    matterContacts: arr("matterContacts"),
    contacts: indexById(arr("contacts")),
    org: (arr("organizations")[0] ?? {}) as Row,
    userName: String((arr("users")[0] as Row | undefined)?.name ?? "Advokaten"),
  };
}

/** Handlebars-kontext för ett ärende. Superset av GenerateModals shape +
 * {{contact}}/{{user}} som seedens mallar refererar. */
function buildCtxForMatter(m: Row, klientName: string, userName: string, org: Row): Record<string, unknown> {
  const base = buildTemplateContext({
    matter: { matterNumber: String(m.matterNumber), title: String(m.title), matterType: (m.matterType as string | null) ?? null },
    recipient: { name: klientName },
    client: { name: klientName },
    organization: { name: org.name as string, orgNumber: org.orgNumber as string, address: org.address as string, email: org.email as string },
    now: m.createdAt ? new Date(m.createdAt as string) : undefined,
  });
  return { ...base, contact: { name: klientName }, user: { name: userName } };
}

export async function populateTemplateDocs(caller: GeneratorCaller, seed: SeedDataset, sink?: BinarySink): Promise<number> {
  const c = caller as AnyCaller;
  const { templates, matters, matterContacts, contacts, org, userName } = templateInputs(seed);
  const fullmakt = templates.find((t) => t.id === "tpl-fullmakt");
  const stamning = templates.find((t) => t.id === "tpl-stamning");

  let count = 0;
  for (const m of matters) {
    const klientName = klientNameFor(String(m.id), matterContacts, contacts);
    const ctx = buildCtxForMatter(m, klientName, userName, org);
    if (fullmakt) { await emitTemplateDoc(c, sink, m, fullmakt, ctx); count++; }
    if (stamning && matterContacts.some((x) => x.matterId === m.id && x.role === "DOMSTOL")) {
      await emitTemplateDoc(c, sink, m, stamning, ctx);
      count++;
    }
  }
  return count;
}
