"use client";

/**
 * Faktureringspanelens meny + Skapa faktura och genvägen "fakturera nu" (#1853).
 *
 * Menyns alternativ kommer från flödesmodellen (#816, ADR 0034); panelen väljer
 * inte per betalningssätt själv. Menyns öppna läge ägs av panelen, så att en
 * genväg kan öppna den utifrån. Vad genvägen öppnar avgör `billingShortcut`,
 * och den routas samma väg som menyvalet (`onPick`).
 */

import { useEffect, useRef } from "react";
import { billingShortcut, type BillingAction, type BillingShortcut, type FlowMatter, type FlowRun } from "@/lib/shared/billing-flow";

interface BillingActionsProps {
  actions: readonly BillingAction[];
  /** Är menyn utfälld? Ägs av panelen (#1853). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (a: BillingAction) => void;
}

/** Skapa-faktura-menyn. Inga actions i fasen → ingen knapp. */
export function BillingActions({ actions, open, onOpenChange, onPick }: BillingActionsProps) {
  if (actions.length === 0) return null;
  return (
    <div className="relative">
      <button onClick={() => onOpenChange(!open)} className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700">
        + Skapa faktura
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => onOpenChange(false)} />
          <div className="absolute right-0 top-full mt-1 z-40 bg-white border border-gray-200 rounded shadow-lg p-1 min-w-[14rem]">
            {actions.map((a) => (
              <button key={a.type}
                onClick={() => { onPick(a); onOpenChange(false); }}
                className="block w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 rounded">
                {a.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Det genvägen behöver av panelen. */
interface ShortcutRequest {
  /** Har någon bett om att fakturera nu? */
  requested: boolean | undefined;
  /** Körningsfrågan — genvägen väntar tills den laddats, annars blir fasen fel. */
  runs: { data?: unknown; isLoading: boolean };
  matter: FlowMatter;
  rows: ReadonlyArray<FlowRun>;
  onPick: (a: BillingAction) => void;
  openMenu: () => void;
  /** Anropas en gång per begäran, också när inget öppnas. */
  onDone?: (() => void) | undefined;
}

function applyShortcut(shortcut: BillingShortcut, onPick: (a: BillingAction) => void, openMenu: () => void): void {
  switch (shortcut.kind) {
    case "dialog": onPick(shortcut.action); return;
    case "menu": openMenu(); return;
    case "none": return;
    default: { const never: never = shortcut; return never; }
  }
}

/**
 * Tar emot en begäran om att fakturera nu och öppnar det `billingShortcut`
 * väljer, en gång per begäran, när körningarna har laddats.
 */
export function useApplyBillingShortcut(req: ShortcutRequest): void {
  const handled = useRef(false);
  const loaded = !req.runs.isLoading && req.runs.data !== undefined;
  useEffect(() => {
    if (!req.requested) { handled.current = false; return; }
    if (!loaded || handled.current) return;
    handled.current = true;
    applyShortcut(billingShortcut(req.matter, req.rows), req.onPick, req.openMenu);
    req.onDone?.();
  }, [req, loaded]);
}
