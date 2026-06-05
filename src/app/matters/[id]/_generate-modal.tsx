"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { FileDown } from "lucide-react";
import { trpc } from "@/lib/client/trpc";
import { labelForMatterRole } from "@/lib/client/labels";
import { buildTemplateContext } from "@/lib/client/templates/build-template-context";
import { renderHandlebars } from "@/lib/client/kostnadsrakning/render-handlebars";

type Contact = { id: string; name: string; email?: string | null; phone?: string | null };
type MatterContact = { id: string; role: string; contact: Contact };

interface Props {
  matterId: string;
  contacts: MatterContact[];
  onClose: () => void;
}

// eslint-disable-next-line max-lines-per-function
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

  // Klientsidig generering — demo/static-export har ingen /api/-route.
  // Vi renderar mallen i browsern via renderHandlebars, öppnar print-flik
  // (PDF via "Spara som PDF" i utskriftsdialogen) + skriver HTML till FSA
  // och registrerar dokumentet via tRPC.
  // eslint-disable-next-line complexity
  const handleGenerate = async () => {
    if (!generateTemplateId) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const tpl = (templates.data ?? []).find((t: { id: string; content?: string; name: string }) => t.id === generateTemplateId);
      if (!tpl?.content) throw new Error("Mallen saknar innehåll.");
      const m = matter.data;
      if (!m) throw new Error("Ärendedata kunde inte laddas.");

      const clientLink = m.contacts?.find((c: { role: string }) => c.role === "KLIENT");
      const recipients = generateRecipientIds.length > 0
        ? contacts.filter((mc) => generateRecipientIds.includes(mc.contact.id)).map((mc) => mc.contact)
        : [null];

      for (const recipient of recipients) {
        const ctx = buildTemplateContext({
          matter: { matterNumber: m.matterNumber, title: m.title, matterType: m.matterType },
          recipient: recipient ? { name: recipient.name, email: recipient.email, phone: recipient.phone } : null,
          client: clientLink ? { name: clientLink.contact.name } : null,
          organization: org.data ? { name: org.data.name, orgNumber: org.data.orgNumber, address: org.data.address, email: org.data.email } : null,
        });
        const html = renderHandlebars(tpl.content, ctx);

        // Öppna i ny flik (auto-print för PDF-format)
        const printable = generateFormat === "pdf"
          ? html.replace("</body>", `<script>setTimeout(function(){window.print();},200);<\/script></body>`)
          : html;
        const blob = new Blob([printable.includes("<body") ? printable : `<!doctype html><html><body>${printable}</body></html>`], { type: "text/html; charset=utf-8" });
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank", "noopener,noreferrer");
        setTimeout(() => URL.revokeObjectURL(url), 60_000);

        // Spara + registrera dokument
        const suffix = recipient ? ` ${recipient.name}` : "";
        const fileName = `${tpl.name}${suffix} ${ctx.today as string}.html`;
        const docId = `gen-${m.matterNumber}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
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
        await register.mutateAsync({
          id: docId, matterId, fileName,
          mimeType: "text/html; charset=utf-8", sizeBytes: bytes.byteLength, storagePath,
        });
      }
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
            templates={templates.data}
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
