/**
 * `Capabilities` (ADR 0027) — kapabilitets-tier för den kapabilitets-tierade
 * klienten: SAMMA web-app, men funktionsuppsättningen avgörs vid bootstrap av
 * vad runtimen kan. Server-beroende förmågor är PÅ i self-hosted (det finns en
 * server) och AV i demon (ingen server). UI:t gate:ar på dessa flaggor —
 * ALDRIG på `if (isDemo)` — så demo och server-väg inte kan driva isär.
 *
 * Slice 1 (#639) härleder tiern ur `firma-config.tier`. Nästa slice byter
 * resolvern mot en server-annonserad `system.capabilities`-probe (ADR 0027
 * beslut 1) — konsumenterna rörs inte, bara hur deskriptorn fylls.
 */

/** Vad den aktiva runtimen kan. Server-beroende förmågor = false i demon. */
export interface Capabilities {
  /** Synk mot en server-auktoritativ backend (annars cache-lokal). */
  sync: boolean;
  /** LLM-dokumentanalys / etikett-förslag (server-jobb, ADR 0024). */
  llm: boolean;
  /** Durabel server-jobbkö. */
  jobs: boolean;
  /** Ledger-/Fortnox-connector (ADR 0011). */
  ledger: boolean;
  /** E-post-/kalender-spegling. */
  mailSync: boolean;
  /** Server-OIDC-auth (annars demo-principal). */
  oidc: boolean;
}

/** Demon: ingen server → alla server-beroende förmågor av. */
export const DEMO_CAPABILITIES: Capabilities = {
  sync: false, llm: false, jobs: false, ledger: false, mailSync: false, oidc: false,
};

/** Self-hosted: en server finns → alla förmågor på (förfinas av probe i nästa slice). */
export const SELF_HOSTED_CAPABILITIES: Capabilities = {
  sync: true, llm: true, jobs: true, ledger: true, mailSync: true, oidc: true,
};

/** Härled kapabiliteterna ur deploy-tiern (slice 1; ersätts av server-probe). */
export function capabilitiesForTier(tier: "demo" | "self-hosted"): Capabilities {
  return tier === "self-hosted" ? SELF_HOSTED_CAPABILITIES : DEMO_CAPABILITIES;
}
