"use client";

import { Trash2, Plus, Pencil, X, Check } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { HourlyRatesFields } from "@/components/billing/hourly-rates-fields";
import { PanelPage } from "@/components/layout/panel-page";
import { DatasourceSection } from "@/components/settings/datasource-section";
import { EditorExtensionsSection } from "@/components/settings/editor-extensions-section";
import { ExternalEditSection } from "@/components/settings/external-edit-section";
import { FortnoxSection } from "@/components/settings/fortnox-section";
import { HelperSection } from "@/components/settings/helper-section";
import { LedgerAccountsSection } from "@/components/settings/ledger-accounts-section";
import { OrgDefaultsSection } from "@/components/settings/org-defaults-section";
import { OrgImageSection } from "@/components/settings/org-image-section";
import { SyncDevicesSection } from "@/components/sync/sync-devices-section";
import { trpc } from "@/lib/client/trpc";
import type { OrgImage } from "@/lib/shared/org-image";
import type { HourlyRates } from "@/lib/shared/schemas/hourly-rates";
import { DocumentTagsSection } from "./_document-tags-section";
import { settingsLayout } from "./_settings-layout";
import { StandardAtgarderSection } from "./_standard-atgarder-section";

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
  /** Webbplats — kostnadsräkningens sidfot (#1218). */
  website: string;
  /** Aconto-gränsbelopp i KRONOR (öre/100) — sparas som öre (#885). */
  accontoThresholdKr: string;
  /** Byråns timpris per kategori (öre/h, #1206) — fälten visar kronor. */
  hourlyRates: HourlyRates;
}

type NullableStr = string | null | undefined;
/** Settings-data → form (null/undefined → ""). Egen helper håller
 *  useOrgSettings under complexity@8 (annars 6× `??`). */
function toOrgForm(d: { name?: NullableStr; orgNumber?: NullableStr; address?: NullableStr; phone?: NullableStr; email?: NullableStr; bankgiro?: NullableStr; website?: NullableStr; accontoThresholdOre?: number | null; hourlyRates?: HourlyRates | undefined }): OrgForm {
  const s = (v: NullableStr): string => v ?? "";
  return {
    name: s(d.name), orgNumber: s(d.orgNumber), address: s(d.address),
    phone: s(d.phone), email: s(d.email), bankgiro: s(d.bankgiro), website: s(d.website),
    accontoThresholdKr: oreToKr(d.accontoThresholdOre),
    hourlyRates: d.hourlyRates ?? {},
  };
}

/** Öre → kronor-sträng för ett formulärfält; inget belopp → "". */
function oreToKr(ore: number | null | undefined): string {
  return ore != null ? String(ore / 100) : "";
}

/** Kronor-sträng → öre (heltal), eller undefined om tomt/ogiltigt (#885). */
function krToOre(kr: string): number | undefined {
  const n = Number.parseFloat(kr.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
}

/** Byrå-inställningar: query + auto-save (debounce 800ms) + form-state.
 *  Populerar formuläret i render-fasen när data anlänt (samma som förr). */
function useOrgSettings() {
  const settings = trpc.organization.getSettings.useQuery();
  const utils = trpc.useUtils();
  const [form, setForm] = useState<OrgForm>({ name: "", orgNumber: "", address: "", phone: "", email: "", bankgiro: "", website: "", accontoThresholdKr: "", hourlyRates: {} });
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
        website: form.website || undefined,
        accontoThresholdOre: krToOre(form.accontoThresholdKr),
        // Hela kartan: ett tömt fält tar bort byråns pris för kategorin.
        hourlyRates: form.hourlyRates,
      });
    }, 800);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, formReady]);

  return { settings, form, setForm, saved, updateSettings };
}

/** Byråns bilder i genererade dokument (#1218): logga och sidfotsmärke. Sparas
 *  direkt (inte via formulärets debounce) — en bild är ett helt värde. */
function OrgImagesSection({ logo, footerSeal, save }: {
  logo: OrgImage | null; footerSeal: OrgImage | null;
  save: (patch: { logo?: OrgImage | null; footerSeal?: OrgImage | null }) => void;
}) {
  return (
    <>
      <OrgImageSection title="Logotyp" description="Visas centrerad överst på kostnadsräkningar och andra genererade dokument (annars byråns namn)."
        value={logo} onChange={(v) => save({ logo: v })} />
      <OrgImageSection title="Sidfotsmärke" description="Visas till vänster i sidfoten, t.ex. märket för ledamot av Sveriges advokatsamfund."
        value={footerSeal} onChange={(v) => save({ footerSeal: v })} />
    </>
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
  const websiteId = useId();
  const thresholdId = useId();
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
          <label htmlFor={websiteId} className="block text-xs font-medium text-gray-700 mb-1">Webbplats</label>
          <input id={websiteId} type="url" value={form.website} placeholder="https://www.byrå.se"
            onChange={(e) => setForm({ ...form, website: e.target.value })}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={bankgiroId} className="block text-xs font-medium text-gray-700 mb-1">Bankgiro</label>
            <input id={bankgiroId} type="text" value={form.bankgiro} placeholder="123-4567"
              onChange={(e) => setForm({ ...form, bankgiro: e.target.value })}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          <div>
            <label htmlFor={thresholdId} className="block text-xs font-medium text-gray-700 mb-1">Gränsbelopp aconto (kr)</label>
            <input id={thresholdId} type="number" min={0} step={100} value={form.accontoThresholdKr} placeholder="1500"
              onChange={(e) => setForm({ ...form, accontoThresholdKr: e.target.value })}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
            <p className="text-[11px] text-gray-500 mt-1">Aconto skickas när klientens självrisk nått detta belopp.</p>
          </div>
        </div>

        <div>
          <h4 className="text-xs font-semibold text-gray-700 mb-1">Timpriser</h4>
          <p className="text-[11px] text-gray-500 mb-2">
            Gäller ny tid när varken juristen eller ärendet har ett eget pris för kategorin. Tomt = samma som timarvodet.
          </p>
          <HourlyRatesFields value={form.hourlyRates} onChange={(hourlyRates) => setForm({ ...form, hourlyRates })} />
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

  if (settings.isLoading) {
    return <div className="p-6 text-sm text-gray-500">Laddar inställningar…</div>;
  }

  const panels = [
    { id: "datasource", title: "Datakälla", render: () => <><PanelIntro text="Var ligger din byrås data? Konfigureras en gång — synkar sedan automatiskt." /><DatasourceSection /></> },
    { id: "org", title: "Byråns uppgifter", render: () => (
      <>
        <PanelIntro text="Visas i genererade dokument (offerter, fakturor, kostnadsräkningar)." />
        <OrgImagesSection logo={settings.data?.logo ?? null} footerSeal={settings.data?.footerSeal ?? null}
          save={(patch) => updateSettings.mutate(patch)} />
        <OrgFieldsForm form={form} setForm={setForm} isPending={updateSettings.isPending} saved={saved} error={updateSettings.error?.message ?? null} />
        <DocFooterPreview form={form} />
      </>
    ) },
    { id: "offices", title: "Kontor", render: () => <><PanelIntro text="Adresser för Stockholm, Göteborg osv. — visas på dokument-sidfot." /><OfficesSection /></> },
    { id: "devices", title: "Enheter och synk", render: () => <><PanelIntro text="Varje webbläsare som synkar mot servern och vad som ligger kvar i dess kö (admin)." /><SyncDevicesSection /></> },
    { id: "external", title: "Extern editering", render: () => <><PanelIntro text="Öppna PDF/Word direkt i din favorit-editor. Valfritt." /><HelperSection /><ExternalEditSection /><EditorExtensionsSection /></> },
    { id: "views", title: "Standardvyer", render: () => <><PanelIntro text="Org-globala kolumn- och sort-defaults för listor (admin). Personliga val vinner." /><OrgDefaultsSection /></> },
    { id: "ledger", title: "Bokföring", render: () => <><PanelIntro text="Fortnox och konto-mappning (BAS) som SIE-exporten och Fortnox bokför mot (admin)." /><FortnoxSection /><LedgerAccountsSection /></> },
    { id: "tags", title: "Dokument-etiketter", render: () => <><PanelIntro text="Giltiga etiketter som dokument kan taggas med — av AI:n och handläggarna (admin)." /><DocumentTagsSection /></> },
    { id: "atgarder", title: "Standardåtgärder", render: () => <><PanelIntro text="Åtgärder som förekommer i varje ärende — samma beskrivning och tidsåtgång för alla (admin)." /><StandardAtgarderSection /></> },
  ];

  return (
    <PanelPage
      page="settings"
      panels={panels}
      defaultLayout={settingsLayout}
      header={(
        <div className="mb-3">
          <h1 className="text-2xl font-bold text-gray-900">Inställningar</h1>
          <p className="text-sm text-gray-500">Ändringar sparas automatiskt — du behöver inte klicka &quot;Spara&quot;.</p>
        </div>
      )}
    />
  );
}

/** Panelens korta förklaring överst. */
function PanelIntro({ text }: { text: string }) {
  return <p className="mb-3 text-xs text-gray-500">{text}</p>;
}

