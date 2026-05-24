"use client";

import { useId, useState, useRef } from "react";
import { trpc } from "@/client/lib/trpc";
import { Upload, Trash2, Building2, Plus, Pencil, X, Check, FolderOpen, Copy } from "lucide-react";
import { DatasourceSection } from "@/client/components/datasource-section";

// ─── WebDAV mount instructions ───────────────────────────────────

function WebDAVSection() {
  const [copied, setCopied] = useState(false);
  // In dev the WebDAV server runs on :3001; behind a reverse proxy in prod
  // it can be the same host. Infer from browser location.
  const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
  const webdavUrl = `http://${host}:3001/`;

  const copyUrl = () => {
    navigator.clipboard.writeText(webdavUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-5">
      <div className="flex items-center gap-2 mb-3">
        <FolderOpen size={16} className="text-gray-500" />
        <h2 className="font-semibold text-gray-900">Öppna dokument i lokala program</h2>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Mounta AVA:s dokumentmappar som en nätverksdisk. Då kan du öppna, redigera
        och spara PDF-filer direkt i t.ex. <strong>PDFGear</strong>, <strong>Adobe Acrobat</strong> eller{" "}
        <strong>Preview</strong> — ändringarna skrivs tillbaka automatiskt.
      </p>

      <div className="flex items-center gap-2 mb-4">
        <code className="flex-1 bg-gray-50 border border-gray-200 rounded px-3 py-1.5 text-xs font-mono text-gray-800">
          {webdavUrl}
        </code>
        <button
          onClick={copyUrl}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50"
        >
          <Copy size={12} />
          {copied ? "Kopierat!" : "Kopiera"}
        </button>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-blue-600 hover:underline font-medium">
          Så mountar du på macOS (Finder)
        </summary>
        <ol className="list-decimal ml-5 mt-2 space-y-1 text-gray-700 text-xs">
          <li>Öppna Finder</li>
          <li>Tryck <kbd className="px-1 border rounded">⌘K</kbd> (eller menyn: Gå → Anslut till server…)</li>
          <li>Klistra in adressen: <code className="bg-gray-100 px-1 rounded">{webdavUrl}</code></li>
          <li>Logga in med din AVA-mejladress och lösenord</li>
          <li>Dina ärenden dyker upp som mappar i Finder</li>
          <li>Dubbelklicka en PDF → öppnas i standardprogrammet (PDFGear, Preview, Acrobat…)</li>
          <li>Gör dina understrykningar och spara med <kbd className="px-1 border rounded">⌘S</kbd></li>
          <li>Ändringen skrivs direkt till AVA — ny version skapas automatiskt</li>
        </ol>
      </details>

      <details className="text-sm mt-2">
        <summary className="cursor-pointer text-blue-600 hover:underline font-medium">
          Så mountar du på Windows (Utforskaren)
        </summary>
        <div className="ml-5 mt-2 text-xs text-gray-700 space-y-2">
          <p>
            Windows kräver HTTPS för att tillåta Basic-auth över WebDAV. I nuläget
            är AVA:s WebDAV-server enbart testad mot macOS — en Windows-anpassning
            (HTTPS + registerändring eller tredjepartsklient som <em>CyberDuck</em> / <em>RaiDrive</em>)
            levereras i ett senare steg.
          </p>
        </div>
      </details>
    </div>
  );
}

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
    onSuccess: () => { utils.organization.listOffices.invalidate(); setAdding(false); setForm(emptyOffice()); },
  });
  const updateOffice = trpc.organization.updateOffice.useMutation({
    onSuccess: () => { utils.organization.listOffices.invalidate(); setEditingId(null); },
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

export default function SettingsPage() {
  const settings = trpc.organization.getSettings.useQuery();
  const utils = trpc.useUtils();

  const updateSettings = trpc.organization.updateSettings.useMutation({
    onSuccess: () => {
      utils.organization.getSettings.invalidate();
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
      .then((d: { logoUrl: string | null }) => setLogoUrl(d.logoUrl))
      .catch(() => {});
  }

  const handleSave = () => {
    updateSettings.mutate({
      name: form.name || undefined,
      orgNumber: form.orgNumber || undefined,
      address: form.address || undefined,
      phone: form.phone || undefined,
      email: form.email || undefined,
      bankgiro: form.bankgiro || undefined,
    });
  };

  const handleLogoUpload = async (file: File) => {
    setLogoLoading(true);
    setLogoError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/organization/logo", { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? "Uppladdning misslyckades");
      }
      const data = await res.json() as { logoUrl: string };
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
        <p className="text-sm text-gray-500 mt-1">Byråns uppgifter används i genererade dokument.</p>
      </div>

      {/* Datakälla & inloggning — engångskonfiguration */}
      <DatasourceSection />

      {/* Logo section */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 mb-5">
        <div className="flex items-center gap-2 mb-4">
          <Building2 size={16} className="text-gray-500" />
          <h2 className="font-semibold text-gray-900">Logotyp</h2>
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
                if (file) handleLogoUpload(file);
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
                onClick={handleLogoDelete}
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

      {/* WebDAV mount section */}
      <WebDAVSection />

      {/* Offices section */}
      <OfficesSection />

      {/* Contact details */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="font-semibold text-gray-900 mb-4">Kontaktuppgifter</h2>
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

        <div className="flex items-center gap-3 mt-5">
          <button
            onClick={handleSave}
            disabled={updateSettings.isPending}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {updateSettings.isPending ? "Sparar…" : "Spara"}
          </button>
          {saved && <span className="text-sm text-green-600">✓ Sparat</span>}
          {updateSettings.error && (
            <span className="text-sm text-red-600">{updateSettings.error.message}</span>
          )}
        </div>
      </div>

      {/* Preview of how footer looks */}
      <div className="mt-5 bg-gray-50 border border-gray-200 rounded-lg p-4">
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
    </div>
  );
}
