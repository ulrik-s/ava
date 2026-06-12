"use client";

import { z } from "zod";
import { useEffect, useId, useRef, useState } from "react";
import { trpc } from "@/lib/client/trpc";
import { Upload, Trash2, Building2, Plus, Pencil, X, Check } from "lucide-react";
import { DatasourceSection } from "@/components/settings/datasource-section";
import { ExternalEditSection } from "@/components/settings/external-edit-section";
import { EditorExtensionsSection } from "@/components/settings/editor-extensions-section";
import { LlmSettingsCard } from "@/components/llm/llm-settings-card";
import { OrgDefaultsSection } from "@/components/settings/org-defaults-section";
import { LedgerAccountsSection } from "@/components/settings/ledger-accounts-section";
import { HelperSection } from "@/components/settings/helper-section";

// Zod vid parsegränsen (#187): logo-API:ts svar valideras.
const logoResponseSchema = z.object({ logoUrl: z.string().nullable() });
const uploadErrorSchema = z.object({ error: z.string().optional() }).passthrough();

// ─── Offices sub-component ───────────────────────────────────────

interface OfficeFormState {
  name: string;
  address: string;
  phone: string;
  email: string;
  isMain: boolean;
}

const emptyOffice = (): OfficeFormState => ({
  name: "",
  address: "",
  phone: "",
  email: "",
  isMain: false,
});

function OfficesSection() {
  const utils = trpc.useUtils();
  const { data: offices = [], isLoading } = trpc.organization.listOffices.useQuery();

  const addOffice = trpc.organization.addOffice.useMutation({
    onSuccess: () => { void utils.organization.listOffices.invalidate(); setAdding(false); setForm(emptyOffice()); },
  });
  const updateOffice = trpc.organization.updateOffice.useMutation({
    onSuccess: () => { void utils.organization.listOffices.invalidate(); setEditingId(null); },
  });
  const deleteOffice = trpc.organization.deleteOffice.useMutation({
    onSuccess: () => utils.organization.listOffices.invalidate(),
  });

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<OfficeFormState>(emptyOffice());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<OfficeFormState>(emptyOffice());

  const startEdit = (o: typeof offices[number]) => {
    setEditingId(o.id);
    setEditForm({ name: o.name, address: o.address ?? "", phone: o.phone ?? "", email: o.email ?? "", isMain: o.isMain });
  };

  if (isLoading) return <div className="text-xs text-gray-400 py-2">Laddar kontor…</div>;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-gray-900">Kontor</h2>
        <button
          onClick={() => { setAdding(true); setForm(emptyOffice()); }}
          className="flex items-center gap-1 px-2.5 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50"
        >
          <Plus size={12} /> Lägg till kontor
        </button>
      </div>

      {offices.length === 0 && !adding && (
        <p className="text-sm text-gray-400 italic">Inga kontor registrerade.</p>
      )}

      <div className="space-y-2">
        {offices.map((o) =>
          editingId === o.id ? (
            <OfficeFormRow
              key={o.id}
              value={editForm}
              onChange={setEditForm}
              onSave={() => updateOffice.mutate({ id: o.id, ...editForm })}
              onCancel={() => setEditingId(null)}
              saving={updateOffice.isPending}
            />
          ) : (
            <div key={o.id} className="flex items-start justify-between gap-2 py-2 border-b border-gray-100 last:border-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">{o.name}</span>
                  {o.isMain && (
                    <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">Huvudkontor</span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-0.5 space-y-0.5">
                  {o.address && <div>{o.address}</div>}
                  <div className="flex gap-3">
                    {o.phone && <span>{o.phone}</span>}
                    {o.email && <span>{o.email}</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => startEdit(o)} className="p-1 text-gray-400 hover:text-gray-700 rounded" title="Redigera">
                  <Pencil size={13} />
                </button>
                <button
                  onClick={() => deleteOffice.mutate({ id: o.id })}
                  className="p-1 text-gray-400 hover:text-red-600 rounded"
                  title="Ta bort"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          )
        )}

        {adding && (
          <OfficeFormRow
            value={form}
            onChange={setForm}
            onSave={() => addOffice.mutate(form)}
            onCancel={() => setAdding(false)}
            saving={addOffice.isPending}
          />
        )}
      </div>
    </div>
  );
}

interface OfficeFormRowProps {
  value: OfficeFormState;
  onChange: (v: OfficeFormState) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}

function OfficeFormRow({ value, onChange, onSave, onCancel, saving }: OfficeFormRowProps) {
  const set = (k: keyof OfficeFormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [k]: k === "isMain" ? e.target.checked : e.target.value });
  const officeNameId = useId();
  const officeAddressId = useId();
  const officePhoneId = useId();
  const officeEmailId = useId();

  return (
    <div className="border border-blue-200 rounded p-3 bg-blue-50 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={officeNameId} className="block text-xs font-medium text-gray-700 mb-1">Namn *</label>
          <input
            id={officeNameId}
            type="text"
            value={value.name}
            onChange={set("name")}
            placeholder="t.ex. Stockholm"
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor={officeAddressId} className="block text-xs font-medium text-gray-700 mb-1">Adress</label>
          <input
            id={officeAddressId}
            type="text"
            value={value.address}
            onChange={set("address")}
            placeholder="Storgatan 1, 111 23 Stockholm"
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor={officePhoneId} className="block text-xs font-medium text-gray-700 mb-1">Telefon</label>
          <input
            id={officePhoneId}
            type="text"
            value={value.phone}
            onChange={set("phone")}
            placeholder="08-123 456 78"
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor={officeEmailId} className="block text-xs font-medium text-gray-700 mb-1">E-post</label>
          <input
            id={officeEmailId}
            type="email"
            value={value.email}
            onChange={set("email")}
            placeholder="stockholm@byrå.se"
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
          <input type="checkbox" checked={value.isMain} onChange={set("isMain")} className="rounded" />
          Huvudkontor
        </label>
        <div className="flex items-center gap-2">
          <button onClick={onCancel} className="p-1 text-gray-500 hover:text-gray-700" title="Avbryt">
            <X size={14} />
          </button>
          <button
            onClick={onSave}
            disabled={!value.name.trim() || saving}
            className="flex items-center gap-1 px-2.5 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            <Check size={12} /> {saving ? "Sparar…" : "Spara"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────

// eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Function 'SettingsPage' has a complexity of 21. Maximum allowed is 8.)
export default function SettingsPage() {
  const settings = trpc.organization.getSettings.useQuery();
  const utils = trpc.useUtils();

  const updateSettings = trpc.organization.updateSettings.useMutation({
    onSuccess: () => {
      void utils.organization.getSettings.invalidate();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const [form, setForm] = useState({
    name: "",
    orgNumber: "",
    address: "",
    phone: "",
    email: "",
    bankgiro: "",
  });
  const [formReady, setFormReady] = useState(false);
  const [saved, setSaved] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoLoading, setLogoLoading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const orgNameId = useId();
  const orgNumberId = useId();
  const orgAddressId = useId();
  const orgPhoneId = useId();
  const orgEmailId = useId();
  const orgBankgiroId = useId();

  // Populate form once data arrives
  if (settings.data && !formReady) {
    setForm({
      name: settings.data.name ?? "",
      orgNumber: settings.data.orgNumber ?? "",
      address: settings.data.address ?? "",
      phone: settings.data.phone ?? "",
      email: settings.data.email ?? "",
      bankgiro: settings.data.bankgiro ?? "",
    });
    setFormReady(true);
    // Fetch current logo
    fetch("/api/organization/logo")
      .then((r) => r.json())
      .then((d: unknown) => setLogoUrl(logoResponseSchema.parse(d).logoUrl))
      .catch(() => {});
  }

  // Auto-save: debounce 800ms efter senaste change. Visar "Sparar…" /
  // "✓ Sparat"-status istället för en separat Spara-knapp. Mönster lånat
  // från Notion/Linear-settings — färre klick, mindre "vad-händer-om-jag-glömmer".
  useEffect(() => {
    if (!formReady) return;
    const id = setTimeout(() => {
      updateSettings.mutate({
        name: form.name || undefined,
        orgNumber: form.orgNumber || undefined,
        address: form.address || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        bankgiro: form.bankgiro || undefined,
      });
    }, 800);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, formReady]);

  const handleLogoUpload = async (file: File) => {
    setLogoLoading(true);
    setLogoError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/organization/logo", { method: "POST", body: fd });
      if (!res.ok) {
        const err = uploadErrorSchema.parse(await res.json());
        throw new Error(err.error ?? "Uppladdning misslyckades");
      }
      const data = logoResponseSchema.parse(await res.json());
      setLogoUrl(data.logoUrl);
    } catch (e) {
      setLogoError(e instanceof Error ? e.message : "Okänt fel");
    } finally {
      setLogoLoading(false);
    }
  };

  const handleLogoDelete = async () => {
    setLogoLoading(true);
    setLogoError(null);
    try {
      await fetch("/api/organization/logo", { method: "DELETE" });
      setLogoUrl(null);
    } catch {
      setLogoError("Kunde inte ta bort logotypen");
    } finally {
      setLogoLoading(false);
    }
  };

  if (settings.isLoading) {
    return <div className="p-6 text-sm text-gray-500">Laddar inställningar…</div>;
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Inställningar</h1>
        <p className="text-sm text-gray-500 mt-1">
          Ändringar sparas automatiskt — du behöver inte klicka &quot;Spara&quot;.
          Konfigurera ovanifrån-och-ner.
        </p>
      </div>

      {/* 1. Datakälla — engångskonfiguration */}
      <SectionHeader num={1} title="Datakälla & inloggning" subtitle="Var ligger din byrås data? Konfigureras en gång — synkar sedan automatiskt." />
      <DatasourceSection />

      {/* 2. Byråns uppgifter — kontakt + logo (auto-save) */}
      <SectionHeader num={2} title="Byråns uppgifter" subtitle="Visas i genererade dokument (offerter, fakturor, kostnadsräkningar)." />

      <div className="bg-white border border-gray-200 rounded-lg p-5 mb-5">
        <div className="flex items-center gap-2 mb-4">
          <Building2 size={16} className="text-gray-500" />
          <h3 className="font-semibold text-gray-900">Logotyp</h3>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Visas i sidhuvudet på alla genererade dokument. PNG, JPEG eller SVG, max 2 MB.
        </p>

        <div className="flex items-center gap-4">
          {/* Preview */}
          <div className="w-40 h-20 border border-gray-200 rounded flex items-center justify-center bg-gray-50 shrink-0 overflow-hidden">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="Logotyp" className="max-h-full max-w-full object-contain p-2" />
            ) : (
              <span className="text-xs text-gray-400">Ingen logotyp</span>
            )}
          </div>

          {/* Controls */}
          <div className="flex flex-col gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleLogoUpload(file);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={logoLoading}
              className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
            >
              <Upload size={14} />
              {logoLoading ? "Laddar upp…" : logoUrl ? "Byt logotyp" : "Ladda upp logotyp"}
            </button>
            {logoUrl && (
              <button
                onClick={() => void handleLogoDelete()}
                disabled={logoLoading}
                className="flex items-center gap-2 px-3 py-1.5 text-sm border border-red-200 text-red-600 rounded hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 size={14} /> Ta bort
              </button>
            )}
          </div>
        </div>
        {logoError && <p className="mt-2 text-sm text-red-600">{logoError}</p>}
      </div>

      {/* Kontaktuppgifter — del av sektion 2 */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 mb-5">
        <h3 className="font-semibold text-gray-900 mb-4">Kontaktuppgifter</h3>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={orgNameId} className="block text-xs font-medium text-gray-700 mb-1">Byråns namn</label>
              <input
                id={orgNameId}
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor={orgNumberId} className="block text-xs font-medium text-gray-700 mb-1">Organisationsnummer</label>
              <input
                id={orgNumberId}
                type="text"
                value={form.orgNumber}
                placeholder="556123-4567"
                onChange={(e) => setForm({ ...form, orgNumber: e.target.value })}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label htmlFor={orgAddressId} className="block text-xs font-medium text-gray-700 mb-1">Adress (huvudkontor)</label>
            <input
              id={orgAddressId}
              type="text"
              value={form.address}
              placeholder="Storgatan 1, 111 23 Stockholm"
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={orgPhoneId} className="block text-xs font-medium text-gray-700 mb-1">Telefon</label>
              <input
                id={orgPhoneId}
                type="text"
                value={form.phone}
                placeholder="08-123 456 78"
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor={orgEmailId} className="block text-xs font-medium text-gray-700 mb-1">E-post</label>
              <input
                id={orgEmailId}
                type="email"
                value={form.email}
                placeholder="info@byrå.se"
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label htmlFor={orgBankgiroId} className="block text-xs font-medium text-gray-700 mb-1">Bankgiro</label>
            <input
              id={orgBankgiroId}
              type="text"
              value={form.bankgiro}
              placeholder="123-4567"
              onChange={(e) => setForm({ ...form, bankgiro: e.target.value })}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 mt-3 text-xs text-gray-500">
          <span className="italic">Ändringar sparas automatiskt.</span>
          {updateSettings.isPending && <span>Sparar…</span>}
          {saved && <span className="text-green-600">✓ Sparat</span>}
          {updateSettings.error && (
            <span className="text-red-600">{updateSettings.error.message}</span>
          )}
        </div>
      </div>

      {/* Preview of how footer looks */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-5">
        <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">Förhandsgranskning av sidfot</p>
        <div className="bg-white border border-gray-200 rounded p-3 text-[11px] text-gray-500 border-t-2">
          <div className="flex items-center justify-between">
            <span>
              {[
                form.name,
                form.address,
                form.phone,
                form.email,
                form.orgNumber ? `Org.nr ${form.orgNumber}` : "",
                form.bankgiro ? `Bg ${form.bankgiro}` : "",
              ]
                .filter(Boolean)
                .join("  ·  ") || <span className="italic text-gray-300">Fyll i uppgifter ovan</span>}
            </span>
            <span className="text-gray-300">Sida 1 av 1</span>
          </div>
        </div>
      </div>

      {/* 3. Lokala kontor */}
      <SectionHeader num={3} title="Lokala kontor" subtitle="Lägg till adresser för Stockholm, Göteborg osv. — visas på dokument-sidfot." />
      <OfficesSection />

      {/* 4. Editera dokument externt */}
      <SectionHeader num={4} title="Editera dokument externt" subtitle="Öppna PDF/Word direkt i din favorit-editor. Valfritt — bara om du vill jobba i andra program än AVA:s inbyggda viewer." />
      <HelperSection />
      <ExternalEditSection />
      <EditorExtensionsSection />

      {/* 5. Standardvyer */}
      <SectionHeader num={5} title="Standardvyer (admin)" subtitle="Org-globala kolumn- och sort-defaults för listor. Personliga val vinner över org-defaults." />
      <OrgDefaultsSection />

      {/* 6. Bokföringsexport */}
      <SectionHeader num={6} title="Bokföringsexport (admin)" subtitle="Konto-mappning (BAS) som SIE-exporten bokför mot. Förifyllt med standard för advokatbyrå." />
      <LedgerAccountsSection />

      {/* 7. Avancerat / opt-in */}
      <SectionHeader num={7} title="Avancerat" subtitle="Opt-in-funktioner som kräver extra resurser eller setup." />
      <div className="mb-5">
        <LlmSettingsCard />
      </div>
    </div>
  );
}

function SectionHeader({ num, title, subtitle }: { num: number; title: string; subtitle?: string }) {
  return (
    <div className="flex items-baseline gap-3 mt-8 mb-3 first:mt-0">
      <span className="flex items-center justify-center h-6 w-6 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold shrink-0">{num}</span>
      <div>
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      </div>
    </div>
  );
}
