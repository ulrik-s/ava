"use client";

/**
 * `FirmaSettingsPanel` — väljer var AVA hämtar sin data (ADR 0016, server-first):
 *
 *   - **Demo** (publik, read-only) — data fetchas från GH Pages, ändringar
 *     sparas inte mellan sessioner.
 *   - **Self-hosted** — byråns server (Postgres + tRPC bakom oauth2-proxy).
 *     Servern nås same-origin, inloggning sker via OIDC — ingen git-URL,
 *     token eller CORS-proxy behövs längre (den gamla iso-git-vägen
 *     pensionerades i #500–#502).
 *
 * Spara → reload sidan så `DemoBootstrap` initierar rätt backend.
 *
 * Sub-komponenter exporteras för isolerad testning.
 */

import { useState } from "react";
import { loadAuthSettings, saveAuthSettings } from "@/lib/client/auth/use-auth-mode";
import { type FirmaConfig, type FirmaTier, saveFirmaConfig, resetToDemo } from "@/lib/client/firma/firma-config";

interface Props {
  initial: FirmaConfig;
  onSaved: () => void;
  onCancel: () => void;
  /** Inline = ingen modal-wrapper, ingen Avbryt-knapp (för /settings-sidan). */
  inline?: boolean;
  /** Extra innehåll (inloggningsstatus, sync-status) som renderas mellan
   *  konfig-fälten och Spara-knappen så knappen hamnar allra längst ner. */
  children?: React.ReactNode;
}

export function FirmaSettingsPanel({ initial, onSaved, onCancel, inline = false, children }: Props) {
  const [tier, setTier] = useState<FirmaTier>(initial.tier);
  const [repo, setRepo] = useState(initial.repo);
  const [allowAnonymousRead, setAllowAnonymousRead] = useState<boolean>(
    () => loadAuthSettings().allowAnonymousRead,
  );

  const save = () => {
    // Bevara övriga fält (principalId, identitet m.fl.) — bara tier/repo ändras här.
    saveFirmaConfig({ ...initial, tier, repo });
    saveAuthSettings({ allowAnonymousRead });
    onSaved();
  };

  const useDemo = () => { resetToDemo(); onSaved(); };

  const wrapperCls = inline
    ? ""
    : "bg-white rounded-lg border border-gray-200 p-6 max-w-2xl mx-auto";

  return (
    <div className={wrapperCls}>
      {!inline && <PanelHeader />}

      <div className={`${inline ? "" : "mt-4 "}space-y-3 text-sm`}>
        <TierPicker value={tier} onChange={setTier} />
        <TierExplainer tier={tier} />
        {tier === "demo" && <DemoRepoField value={repo} onChange={setRepo} />}
        <AnonymousReadToggle checked={allowAnonymousRead} onChange={setAllowAnonymousRead} />
      </div>

      {children}

      <FooterButtons
        inline={inline}
        canSave={tier !== "demo" || !!repo}
        onSave={save}
        onCancel={onCancel}
        onUseDemo={useDemo}
      />
    </div>
  );
}

// ─── Sub-komponenter ──────────────────────────────────────────────────────

function PanelHeader() {
  return (
    <>
      <h2 className="text-lg font-semibold text-gray-900">Välj firma / datakälla</h2>
      <p className="text-sm text-gray-600 mt-1">
        Demo (publik, read-only) eller self-hosted (din byrås server — Postgres,
        inloggning via OIDC). Servern nås same-origin; ingen git-URL behövs.
      </p>
    </>
  );
}

const TIER_LABELS: Record<FirmaTier, string> = {
  "demo": "1. Demo (publik)",
  "self-hosted": "2. Self-hosted (din server)",
};

export function TierPicker({ value, onChange }: { value: FirmaTier; onChange: (t: FirmaTier) => void }) {
  const tiers: FirmaTier[] = ["demo", "self-hosted"];
  return (
    <div>
      <label className="text-xs text-gray-500 mb-1 block">Läge</label>
      <div className="flex gap-2">
        {tiers.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onChange(t)}
            className={`px-3 py-1.5 rounded text-xs ${
              value === t
                ? "bg-blue-600 text-white"
                : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
            }`}
          >
            {TIER_LABELS[t]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Förklarande hjälptext per läge. */
export function TierExplainer({ tier }: { tier: FirmaTier }) {
  if (tier === "demo") {
    return (
      <p className="text-xs text-gray-500">
        Publik demo-data via GH Pages. Read-only — ändringar du gör syns i
        appen men sparas inte mellan sessioner.
      </p>
    );
  }
  return (
    <p className="text-xs text-gray-500">
      Din byrås data ligger på er server (Postgres). Du loggar in via OIDC och
      klienten är offline-first — ändringar sparas lokalt och synkas automatiskt
      mot servern. Servern nås same-origin (bakom oauth2-proxy).
    </p>
  );
}

/** Repo-fält — bara relevant för demon (vilket GH-Pages-repo seedar datan). */
export function DemoRepoField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500 mb-1 block">Demo-repo (GH Pages)</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="ulrik-s/ava-demo"
        className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm font-mono"
      />
    </label>
  );
}

export function AnonymousReadToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 pt-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-xs text-gray-700">
        Tillåt anonym läsning (avmarkera = kräv inloggning för att se data)
      </span>
    </label>
  );
}

export function FooterButtons(props: {
  inline: boolean;
  canSave: boolean;
  onSave: () => void;
  onCancel: () => void;
  onUseDemo: () => void;
}) {
  return (
    <div className="mt-6 flex items-center justify-between">
      <button type="button" onClick={props.onUseDemo} className="text-xs text-gray-500 hover:underline">
        Återställ till demo
      </button>
      <div className="flex gap-2">
        {!props.inline && (
          <button
            type="button"
            onClick={props.onCancel}
            className="px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
          >
            Avbryt
          </button>
        )}
        <button
          type="button"
          onClick={props.onSave}
          disabled={!props.canSave}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300"
        >
          Spara
        </button>
      </div>
    </div>
  );
}
