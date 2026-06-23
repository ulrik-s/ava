"use client";

import { FileDown } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { renderHandlebars } from "@/lib/client/kostnadsrakning/render-handlebars";
import { labelForMatterRole } from "@/lib/client/labels";
import { buildTemplateContext } from "@/lib/client/templates/build-template-context";
import { trpc } from "@/lib/client/trpc";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import type { MatterId } from "@/lib/shared/schemas/ids";

type Contact = { id: string; name: string; email?: string | null; phone?: string | null };
type MatterContact = { id: string; role: string; contact: Contact };

interface Props {
  matterId: MatterId;
  contacts: MatterContact[];
  onClose: () => void;
}

type Recipient = { name: string; email?: string | null; phone?: string | null };
type GenMatter = { matterNumber: string; title: string; matterType?: string | null; contacts?: Array<{ role: string; contact: { name: string } }> };
type GenOrg = { name: string; orgNumber?: string | null; address?: string | null; email?: string | null } | undefined;
type RegisterDocInput = { id: string; matterId: MatterId; fileName: string; mimeType: string; sizeBytes: number; storagePath: string };

interface GenerateArgs {
  templateId: string;
  format: "pdf" | "docx";
  recipientIds: string[];
  templates: Array<{ id: string; content?: string | null; name: string }> | undefined;
  matter: GenMatter | undefined;
  org: GenOrg;
  contacts: MatterContact[];
  matterId: MatterId;
  registerDoc: (d: RegisterDocInput) => Promise<unknown>;
}

/** Bygg mall-kontexten för en mottagare (eller ett generellt dokument). */
function buildDocCtx(m: GenMatter, recipient: Recipient | null, org: GenOrg) {
  const clientLink = m.contacts?.find((c) => c.role === "KLIENT");
  return buildTemplateContext({
    matter: { matterNumber: m.matterNumber, title: m.title, ...omitUndefined({ matterType: m.matterType }) },
    recipient: recipient ? { name: recipient.name, ...omitUndefined({ email: recipient.email, phone: recipient.phone }) } : null,
    client: clientLink ? { name: clientLink.contact.name } : null,
    organization: org ? { name: org.name, ...omitUndefined({ orgNumber: org.orgNumber, address: org.address, email: org.email }) } : null,
  });
}

/** Rendera + öppna print-flik + skriv till FSA + registrera ETT dokument. */
async function generateOneDoc(opts: {
  content: string; name: string; ctx: ReturnType<typeof buildTemplateContext>;
  format: "pdf" | "docx"; recipient: Recipient | null; matterId: MatterId;
  registerDoc: (d: RegisterDocInput) => Promise<unknown>;
}): Promise<void> {
  const { content, name, ctx, format, recipient, matterId, registerDoc } = opts;
  const html = renderHandlebars(content, ctx);
  const printable = format === "pdf"
    ? html.replace("</body>", `<script>setTimeout(function(){window.print();},200);<\/script></body>`)
    : html;
  const blob = new Blob([printable.includes("<body") ? printable : `<!doctype html><html><body>${printable}</body></html>`], { type: "text/html; charset=utf-8" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);

  const suffix = recipient ? ` ${recipient.name}` : "";
  const fileName = `${name}${suffix} ${ctx.today as string}.html`;
  const docId = `gen-${matterId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const storagePath = `documents/content/${docId}.html`;
  const bytes = new TextEncoder().encode(html);
  try {
    const { loadHandle } = await import("@/lib/client/fsa/handle-store");
    const { FsaIsoGitAdapter } = await import("@/lib/client/fsa/fs-adapter");
    const handle = await loadHandle("repo-root");
    if (handle) await new FsaIsoGitAdapter(handle).writeFile("/" + storagePath, bytes);
  } catch (e) {
    console.warn("[generate] FSA-skrivning misslyckades:", e);
  }
  await registerDoc({ id: docId, matterId, fileName, mimeType: "text/html; charset=utf-8", sizeBytes: bytes.byteLength, storagePath });
}

/**
 * Klientsidig generering — demo/static-export har ingen /api/-route. Renderar
 * mallen i browsern, öppnar print-flik (PDF via utskriftsdialogen), skriver
 * HTML till FSA och registrerar dokumentet. Ett dokument per vald mottagare
 * (eller ett generellt om inga valda). Kastar vid fel.
 */
async function runGenerate(a: GenerateArgs): Promise<void> {
  const tpl = (a.templates ?? []).find((t) => t.id === a.templateId);
  if (!tpl?.content) throw new Error("Mallen saknar innehåll.");
  if (!a.matter) throw new Error("Ärendedata kunde inte laddas.");
  const recipients: Array<Recipient | null> = a.recipientIds.length > 0
    ? a.contacts.filter((mc) => a.recipientIds.includes(mc.contact.id)).map((mc) => mc.contact)
    : [null];
  for (const recipient of recipients) {
    const ctx = buildDocCtx(a.matter, recipient, a.org);
    await generateOneDoc({ content: tpl.content, name: tpl.name, ctx, format: a.format, recipient, matterId: a.matterId, registerDoc: a.registerDoc });
  }
}

export function GenerateModal({ matterId, contacts, onClose }: Props) {
  const utils = trpc.useUtils();
  const templates = trpc.documentTemplate.list.useQuery();
  const matter = trpc.matter.getById.useQuery({ id: matterId });
  const org = trpc.organization.getSettings.useQuery();
  const register = trpc.document.register.useMutation();
  const [generateTemplateId, setGenerateTemplateId] = useState("");
  const [generateFormat, setGenerateFormat] = useState<"pdf" | "docx">("pdf");
  const [generateRecipientIds, setGenerateRecipientIds] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const generateTemplateFieldId = useId();

  const toggleRecipient = (contactId: string) => {
    setGenerateRecipientIds((prev) =>
      prev.includes(contactId) ? prev.filter((x) => x !== contactId) : [...prev, contactId]
    );
  };

  const handleGenerate = async () => {
    if (!generateTemplateId) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      await runGenerate({
        templateId: generateTemplateId, format: generateFormat, recipientIds: generateRecipientIds,
        templates: templates.data, matter: matter.data as GenMatter | undefined, org: org.data as GenOrg,
        contacts, matterId,
        registerDoc: (d) => register.mutateAsync(d as Parameters<typeof register.mutateAsync>[0]),
      });
      void utils.document.tree.invalidate({ matterId });
      onClose();
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "Okänt fel");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
        <h3 className="font-semibold text-gray-900 mb-4">Generera dokument</h3>

        <div className="space-y-4">
          <TemplateSelector
            id={generateTemplateFieldId}
            isLoading={templates.isLoading}
            templates={templates.data?.map((t) => ({
              id: t.id,
              name: String(t.name),
              category: (t.category as string | null) ?? null,
            }))}
            value={generateTemplateId}
            onChange={setGenerateTemplateId}
          />

          <RecipientPicker
            contacts={contacts}
            selectedIds={generateRecipientIds}
            onToggle={toggleRecipient}
          />

          <FormatPicker value={generateFormat} onChange={setGenerateFormat} />

          {generateError && <p className="text-sm text-red-600">{generateError}</p>}
        </div>

        <div className="flex gap-2 justify-end mt-6">
          <button
            onClick={onClose}
            disabled={generating}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
          >
            Avbryt
          </button>
          <button
            onClick={() => void handleGenerate()}
            disabled={!generateTemplateId || generating}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileDown size={14} />
            {generating ? "Genererar…" : "Generera"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TemplateSelector({
  id,
  isLoading,
  templates,
  value,
  onChange,
}: {
  id: string;
  isLoading: boolean;
  templates: Array<{ id: string; name: string; category: string | null }> | undefined;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-700 mb-1">Mall</label>
      {isLoading ? (
        <p className="text-sm text-gray-400">Laddar mallar…</p>
      ) : templates?.length === 0 ? (
        <p className="text-sm text-gray-500">
          Inga mallar skapade.{" "}
          <Link href="/templates/new" className="text-blue-600 hover:underline">
            Skapa en mall
          </Link>
        </p>
      ) : (
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">Välj mall…</option>
          {templates?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.category ? `${t.category} – ` : ""}{t.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function RecipientPicker({
  contacts,
  selectedIds,
  onToggle,
}: {
  contacts: MatterContact[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">
        Mottagare ({selectedIds.length})
        <span className="ml-1 font-normal text-gray-500">
          — lämna tomt för ett generellt dokument, eller välj flera för att generera ett dokument per mottagare
        </span>
      </label>
      {contacts.length === 0 ? (
        <p className="text-xs text-gray-400">Inga kontakter kopplade till ärendet.</p>
      ) : (
        <div className="max-h-40 overflow-y-auto border border-gray-200 rounded divide-y divide-gray-100">
          {contacts.map((mc) => {
            const checked = selectedIds.includes(mc.contact.id);
            return (
              <label
                key={mc.id}
                className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(mc.contact.id)}
                  className="accent-blue-600"
                />
                <span className="flex-1 truncate">{mc.contact.name}</span>
                <span className="text-[10px] rounded-full bg-gray-100 text-gray-600 px-2 py-0.5">
                  {labelForMatterRole(mc.role)}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FormatPicker({
  value,
  onChange,
}: {
  value: "pdf" | "docx";
  onChange: (v: "pdf" | "docx") => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-2">Format</label>
      <div className="flex gap-4">
        {(["pdf", "docx"] as const).map((fmt) => (
          <label key={fmt} className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="format"
              value={fmt}
              checked={value === fmt}
              onChange={() => onChange(fmt)}
              className="accent-blue-600"
            />
            <span className="text-sm">{fmt === "pdf" ? "PDF (via utskrift)" : "HTML-fil"}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
