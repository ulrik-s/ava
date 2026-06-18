"use client";

/**
 * `/profile` — egen profil: uppdatera dina uppgifter + anslut externa tjänster.
 *
 * (SSH-nyckel-hanteringen togs bort med git-vägen — server-first identifierar
 * användaren via OIDC/oauth2-proxy, ADR 0009; ingen klient-sidig commit-signering
 * längre.) Admin når andra användares profiler via `/users`.
 */

import { User } from "lucide-react";
import { useEffect, useState } from "react";
import { IntegrationsSection } from "@/components/settings/integrations-section";
import { trpc } from "@/lib/client/trpc";

export default function ProfilePage() {
  const me = trpc.user.current.useQuery();
  const utils = trpc.useUtils();
  const updateUser = trpc.user.update.useMutation({ onSuccess: () => utils.user.current.invalidate() });

  const [form, setForm] = useState({ name: "", title: "", email: "" });
  const [formReady, setFormReady] = useState(false);

  useEffect(() => {
    if (me.data && !formReady) {
      queueMicrotask(() => {
        if (!me.data) return;
        setForm({
          name: me.data.name ?? "",
          title: me.data.title ?? "",
          email: me.data.email ?? "",
        });
        setFormReady(true);
      });
    }
  }, [me.data, formReady]);

  if (me.isLoading) return <div className="p-6 text-sm text-gray-500">Laddar profil…</div>;
  if (!me.data) return <div className="p-6 text-sm text-red-600">Kunde inte ladda profil.</div>;

  const u = me.data;

  const saveProfile = () => {
    updateUser.mutate({ id: u.id, name: form.name, title: form.title || null, email: form.email });
  };

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <User size={22} /> Min profil
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Dina uppgifter syns för hela firman.
        </p>
      </div>

      <ProfileBasicsSection
        form={form}
        setForm={setForm}
        role={u.role}
        onSave={saveProfile}
        saving={updateUser.isPending}
        saveError={updateUser.error?.message ?? null}
      />

      {/* Anslutna tjänster (O365, Google, …) */}
      <IntegrationsSection />
    </div>
  );
}

type ProfileForm = { name: string; title: string; email: string };

function ProfileBasicsSection({ form, setForm, role, onSave, saving, saveError }: {
  form: ProfileForm;
  setForm: React.Dispatch<React.SetStateAction<ProfileForm>>;
  role: string;
  onSave: () => void;
  saving: boolean;
  saveError: string | null;
}) {
  return (
    <section className="bg-white border border-gray-200 rounded-lg p-5 mb-5">
      <h2 className="font-semibold text-gray-900 mb-3">Dina uppgifter</h2>
      <div className="space-y-3 text-sm">
        <Field label="Namn">
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
          />
        </Field>
        <Field label="Titel">
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="t.ex. Advokat / Biträdande jurist"
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
          />
        </Field>
        <Field label="E-post">
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
          />
        </Field>
        <Field label="Roll">
          <div className="text-sm text-gray-700">{role}
            <span className="text-xs text-gray-400 ml-2">(ändras av admin)</span>
          </div>
        </Field>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Sparar…" : "Spara"}
        </button>
        {saveError && <span className="text-xs text-red-600">{saveError}</span>}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-500 mb-1 block">{label}</span>
      {children}
    </label>
  );
}
