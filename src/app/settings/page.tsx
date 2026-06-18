"use client";

import { Upload, Trash2, Building2, Plus, Pencil, X, Check } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { DatasourceSection } from "@/components/settings/datasource-section";
import { EditorExtensionsSection } from "@/components/settings/editor-extensions-section";
import { ExternalEditSection } from "@/components/settings/external-edit-section";
import { HelperSection } from "@/components/settings/helper-section";
import { LedgerAccountsSection } from "@/components/settings/ledger-accounts-section";
import { OrgDefaultsSection } from "@/components/settings/org-defaults-section";
import { trpc } from "@/lib/client/trpc";

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

interface OrgForm {
  name: string;
  orgNumber: string;
  address: string;
  phone: string;
  email: string;
  bankgiro: string;
}

type NullableStr = string | null | undefined;
/** Settings-data → form (null/undefined → ""). Egen helper håller
 *  useOrgSettings under complexity@8 (annars 6× `??`). */
function toOrgForm(d: { name?: NullableStr; orgNumber?: NullableStr; address?: NullableStr; phone?: NullableStr; email?: NullableStr; bankgiro?: NullableStr }): OrgForm {
  const s = (v: NullableStr): string => v ?? "";
  return {
    name: s(d.name), orgNumber: s(d.orgNumber), address: s(d.address),
    phone: s(d.phone), email: s(d.email), bankgiro: s(d.bankgiro),
  };
}

/** Byrå-inställningar: query + auto-save (debounce 800ms) + form-state.
 *  Populerar formuläret i render-fasen när data anlänt (samma som förr). */
function useOrgSettings() {
  const settings = trpc.organization.getSettings.useQuery();
  const utils = trpc.useUtils();
  const [form, setForm] = useState<OrgForm>({ name: "", orgNumber: "", address: "", phone: "", email: "", bankgiro: "" });
  const [formReady, setFormReady] = useState(false);
  const [saved, setSaved] = useState(false);

  const updateSettings = trpc.organization.updateSettings.useMutation({
    onSuccess: () => {
      void utils.organization.getSettings.invalidate();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  if (settings.data && !formReady) {
    setForm(toOrgForm(settings.data));
    setFormReady(true);
  }

  useEffect(() => {
    if (!formReady) return;
    const id = setTimeout(() => {
      updateSettings.mutate({
        name: form.name || undefined, orgNumber: form.orgNumber || undefined,
        address: form.address || undefined, phone: form.phone || undefined,
        email: form.email || undefined, bankgiro: form.bankgiro || undefined,
      });
    }, 800);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, formReady]);

  return { settings, form, setForm, saved, updateSettings };
}

interface OrgLogo {
  logoUrl: string | null;
  logoLoading: boolean;
  logoError: string | null;
  onUpload: (file: File) => Promise<void>;
  onDelete: () => Promise<void>;
}

/** Logo-state + upp-/nedladdning mot /api/organization/logo. */
function useOrgLogo(): OrgLogo {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoLoading, setLogoLoading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/organization/logo")
      .then((r) => r.json())
      .then((d: unknown) => setLogoUrl(logoResponseSchema.parse(d).logoUrl))
      .catch(() => {});
  }, []);

  const onUpload = async (file: File): Promise<void> => {
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
      setLogoUrl(logoResponseSchema.parse(await res.json()).logoUrl);
    } catch (e) {
      setLogoError(e instanceof Error ? e.message : "Okänt fel");
    } finally {
      setLogoLoading(false);
    }
  };

  const onDelete = async (): Promise<void> => {
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

  return { logoUrl, logoLoading, logoError, onUpload, onDelete };
}

/** Logotyp-sektionen (preview + ladda upp/byt/ta bort). */
function OrgLogoSection({ logo }: { logo: OrgLogo }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-5">
      <div className="flex items-center gap-2 mb-4">
        <Building2 size={16} className="text-gray-500" />
        <h3 className="font-semibold text-gray-900">Logotyp</h3>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Visas i sidhuvudet på alla genererade dokument. PNG, JPEG eller SVG, max 2 MB.
      </p>

      <div className="flex items-center gap-4">
        <div className="w-40 h-20 border border-gray-200 rounded flex items-center justify-center bg-gray-50 shrink-0 overflow-hidden">
          {logo.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo.logoUrl} alt="Logotyp" className="max-h-full max-w-full object-contain p-2" />
          ) : (
            <span className="text-xs text-gray-400">Ingen logotyp</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void logo.onUpload(file);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={logo.logoLoading}
            className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            <Upload size={14} />
            {logo.logoLoading ? "Laddar upp…" : logo.logoUrl ? "Byt logotyp" : "Ladda upp logotyp"}
          </button>
          {logo.logoUrl && (
            <button
              onClick={() => void logo.onDelete()}
              disabled={logo.logoLoading}
              className="flex items-center gap-2 px-3 py-1.5 text-sm border border-red-200 text-red-600 rounded hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 size={14} /> Ta bort
            </button>
          )}
        </div>
      </div>
      {logo.logoError && <p className="mt-2 text-sm text-red-600">{logo.logoError}</p>}
    </div>
  );
}

interface OrgFieldsProps {
  form: OrgForm;
  setForm: (f: OrgForm) => void;
  isPending: boolean;
  saved: boolean;
  error: string | null;
}

/** Byråns kontaktuppgifter (auto-save-status i foten). */
function OrgFieldsForm({ form, setForm, isPending, saved, error }: OrgFieldsProps) {
  const nameId = useId();
  const numberId = useId();
  const addressId = useId();
  const phoneId = useId();
  const emailId = useId();
  const bankgiroId = useId();
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-5">
      <h3 className="font-semibold text-gray-900 mb-4">Kontaktuppgifter</h3>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={nameId} className="block text-xs font-medium text-gray-700 mb-1">Byråns namn</label>
            <input id={nameId} type="text" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          <div>
            <label htmlFor={numberId} className="block text-xs font-medium text-gray-700 mb-1">Organisationsnummer</label>
            <input id={numberId} type="text" value={form.orgNumber} placeholder="556123-4567"
              onChange={(e) => setForm({ ...form, orgNumber: e.target.value })}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
        </div>

        <div>
          <label htmlFor={addressId} className="block text-xs font-medium text-gray-700 mb-1">Adress (huvudkontor)</label>
          <input id={addressId} type="text" value={form.address} placeholder="Storgatan 1, 111 23 Stockholm"
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={phoneId} className="block text-xs font-medium text-gray-700 mb-1">Telefon</label>
            <input id={phoneId} type="text" value={form.phone} placeholder="08-123 456 78"
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          <div>
            <label htmlFor={emailId} className="block text-xs font-medium text-gray-700 mb-1">E-post</label>
            <input id={emailId} type="email" value={form.email} placeholder="info@byrå.se"
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
        </div>

        <div>
          <label htmlFor={bankgiroId} className="block text-xs font-medium text-gray-700 mb-1">Bankgiro</label>
          <input id={bankgiroId} type="text" value={form.bankgiro} placeholder="123-4567"
            onChange={(e) => setForm({ ...form, bankgiro: e.target.value })}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
      </div>

      <div className="flex items-center gap-3 mt-3 text-xs text-gray-500">
        <span className="italic">Ändringar sparas automatiskt.</span>
        {isPending && <span>Sparar…</span>}
        {saved && <span className="text-green-600">✓ Sparat</span>}
        {error && <span className="text-red-600">{error}</span>}
      </div>
    </div>
  );
}

/** Förhandsgranskning av dokument-sidfoten från byrå-uppgifterna. */
function DocFooterPreview({ form }: { form: OrgForm }) {
  return (
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
  );
}

export default function SettingsPage() {
  const { settings, form, setForm, saved, updateSettings } = useOrgSettings();
  const logo = useOrgLogo();

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
      <OrgLogoSection logo={logo} />
      <OrgFieldsForm
        form={form}
        setForm={setForm}
        isPending={updateSettings.isPending}
        saved={saved}
        error={updateSettings.error?.message ?? null}
      />
      <DocFooterPreview form={form} />

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
