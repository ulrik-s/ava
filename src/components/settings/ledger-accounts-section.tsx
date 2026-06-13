"use client";

/**
 * `LedgerAccountsSection` (#249) — admin redigerar byråns roll→konto-mappning
 * (BAS-konton + verifikatserie) som används av bokföringsexporten (SIE m.fl.).
 * Förifylls med byråns sparade mappning, annars BAS-standard. Strikt zod-
 * validering vid spar; completeness-gaten i renderaren kräver de tre
 * obligatoriska rollerna.
 */

import { useEffect, useState } from "react";
import { trpc } from "@/lib/client/trpc";
import {
  DEFAULT_LEDGER_ACCOUNT_MAP,
  ledgerAccountMapSchema,
  type LedgerAccount,
  type LedgerAccountMap,
} from "@/lib/shared/accounting/account-map";

interface RoleDef {
  key: "kundfordran" | "intaktArvode" | "momsUtgaende" | "intaktUtlagg";
  label: string;
  optional?: boolean;
}

const ROLES: readonly RoleDef[] = [
  { key: "kundfordran", label: "Kundfordran (debet)" },
  { key: "intaktArvode", label: "Intäkt arvode (kredit)" },
  { key: "momsUtgaende", label: "Utgående moms (kredit)" },
  { key: "intaktUtlagg", label: "Intäkt utlägg (valfritt)", optional: true },
];

type Draft = Record<RoleDef["key"], LedgerAccount>;

function toDraft(map: LedgerAccountMap): Draft {
  const empty: LedgerAccount = { number: "", name: "" };
  return {
    kundfordran: map.kundfordran,
    intaktArvode: map.intaktArvode,
    momsUtgaende: map.momsUtgaende,
    intaktUtlagg: map.intaktUtlagg ?? empty,
  };
}

/** Bygg en (ev. ogiltig) mappning ur formuläret; tomt utläggskonto utelämnas. */
function draftToMap(series: string, draft: Draft): unknown {
  const utlagg = draft.intaktUtlagg;
  const hasUtlagg = utlagg.number !== "" || utlagg.name !== "";
  return {
    voucherSeries: series,
    kundfordran: draft.kundfordran,
    intaktArvode: draft.intaktArvode,
    momsUtgaende: draft.momsUtgaende,
    ...(hasUtlagg ? { intaktUtlagg: utlagg } : {}),
  };
}

function AccountRow({
  role,
  value,
  onChange,
}: {
  role: RoleDef;
  value: LedgerAccount;
  onChange: (next: LedgerAccount) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <label className="w-48 text-sm text-gray-700">{role.label}</label>
      <input
        aria-label={`${role.label} kontonummer`}
        value={value.number}
        onChange={(e) => onChange({ ...value, number: e.target.value })}
        placeholder="1510"
        className="w-24 rounded border border-gray-300 px-2 py-1 text-sm font-mono"
      />
      <input
        aria-label={`${role.label} kontonamn`}
        value={value.name}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
        placeholder="Kontonamn"
        className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
      />
    </div>
  );
}

function LedgerAccountForm({ initial }: { initial: LedgerAccountMap }) {
  const utils = trpc.useUtils();
  const [series, setSeries] = useState(initial.voucherSeries);
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = trpc.organization.updateSettings.useMutation({
    onSuccess: () => {
      setSaved(true);
      void utils.organization.getSettings.invalidate();
    },
  });

  function setRole(key: RoleDef["key"], next: LedgerAccount): void {
    setSaved(false);
    setDraft((d) => ({ ...d, [key]: next }));
  }

  function handleSave(): void {
    const parsed = ledgerAccountMapSchema.safeParse(draftToMap(series, draft));
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Ogiltig konto-mappning");
      return;
    }
    setError(null);
    save.mutate({ ledgerAccountMap: parsed.data });
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-5">
      <h2 className="font-semibold text-gray-900 mb-1">Konto-mappning (bokföringsexport)</h2>
      <p className="text-xs text-gray-500 mb-4">
        BAS-konton som bokföringen bokför mot — driver både SIE-exporten och
        Fortnox-connectorn. Förifyllt med standard för advokatbyrå. Saknas
        mappningen vägrar Fortnox-connectorn att boka (completeness-grind).
      </p>

      <div className="flex items-center gap-3 py-1.5 mb-2">
        <label className="w-48 text-sm text-gray-700">Verifikatserie</label>
        <input
          aria-label="Verifikatserie"
          value={series}
          onChange={(e) => {
            setSaved(false);
            setSeries(e.target.value);
          }}
          placeholder="A"
          className="w-24 rounded border border-gray-300 px-2 py-1 text-sm font-mono"
        />
      </div>

      {ROLES.map((role) => (
        <AccountRow key={role.key} role={role} value={draft[role.key]} onChange={(next) => setRole(role.key, next)} />
      ))}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={save.isPending}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Spara mappning
        </button>
        {save.isPending && <span className="text-xs text-gray-500">Sparar…</span>}
        {saved && !error && <span className="text-xs text-green-600">Sparat ✓</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
        {save.error && <span className="text-xs text-red-600">{save.error.message}</span>}
      </div>
    </div>
  );
}

export function LedgerAccountsSection() {
  // Mount-grind: rendera inget förrän appen hydrerat + bootstrap:en är klar.
  // Under self-hosted-bootstrapen ("Laddar data…") pågår en re-render-cykel i
  // shell:en; att delta i den render-fasen med queries/formulär svälter
  // commit-fasen (#249-regression). Vi väntar därför till post-mount.
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- engångs-flip post-mount; det ÄR avsikten (jfr demo-bootstrap)
  useEffect(() => setMounted(true), []);

  const me = trpc.user.current.useQuery(undefined, { enabled: mounted });
  const settings = trpc.organization.getSettings.useQuery(undefined, { enabled: mounted });

  if (!mounted) return null;

  if (me.data?.role !== "ADMIN") {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-5 mb-5">
        <p className="text-sm text-gray-500">Endast administratörer kan redigera konto-mappningen.</p>
      </div>
    );
  }
  if (settings.isLoading) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-5 mb-5">
        <p className="text-xs text-gray-400">Laddar…</p>
      </div>
    );
  }

  const initial = (settings.data?.ledgerAccountMap as LedgerAccountMap | null) ?? DEFAULT_LEDGER_ACCOUNT_MAP;
  return <LedgerAccountForm initial={initial} />;
}
