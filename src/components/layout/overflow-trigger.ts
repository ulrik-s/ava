"use client";

/**
 * Överflödesknappen i dockviews flikrad (#1292). Flikar som inte ryms i en smal
 * grupp (en halv skärm i en tiling-fönsterhanterare, 1024 px) göms bakom
 * dockviews "⌄ N": en div utan roll och utan tangentbordsstöd, som dessutom var
 * nästan osynlig. dockview låter oss inte byta ut den, så vi märker upp den där
 * den står: roll, tabbstopp, ett begripligt namn och Enter/mellanslag.
 * Utseendet ligger i globals.css.
 */

import { useCallback, useRef, type RefCallback } from "react";

const TRIGGER = ".dv-tabs-overflow-dropdown-root";
const DECORATED = "avaOverflowKeys";

/** "1 dold flik" / "3 dolda flikar". */
export function overflowLabel(count: number): string {
  return count === 1 ? "1 dold flik" : `${count} dolda flikar`;
}

/** Öppna listan som ett klick gör: dockview förankrar menyn i klickets position. */
function openFromKeyboard(root: HTMLElement, e: KeyboardEvent): void {
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  // dockview stänger listan på Enter (på window). Utan stopp stängde samma
  // tangenttryck listan direkt efter att den öppnats.
  e.stopPropagation();
  const r = root.getBoundingClientRect();
  root.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.left + r.width / 2, clientY: r.bottom }));
}

function decorate(root: HTMLElement): void {
  const count = Number.parseInt(root.textContent ?? "", 10);
  const label = Number.isNaN(count) ? "Dolda flikar" : overflowLabel(count);
  root.setAttribute("role", "button");
  root.tabIndex = 0;
  root.setAttribute("aria-label", label);
  root.title = label;
  if (root.dataset[DECORATED]) return;
  root.dataset[DECORATED] = "1";
  root.addEventListener("keydown", (e) => { openFromKeyboard(root, e); });
}

/** Märk upp överflödesknapparna i `container`, nu och när dockview ändrar dem. Returnerar stopp. */
export function labelOverflowTriggers(container: HTMLElement): () => void {
  const run = (): void => { container.querySelectorAll<HTMLElement>(TRIGGER).forEach(decorate); };
  run();
  // Bara barn och text bevakas — attributen vi själva sätter ger ingen ny körning.
  const observer = new MutationObserver(run);
  observer.observe(container, { childList: true, subtree: true, characterData: true });
  return () => { observer.disconnect(); };
}

/** Ref för dockytans behållare: märker upp överflödesknapparna så länge den är monterad. */
export function useOverflowTriggerLabels(): RefCallback<HTMLElement> {
  const stop = useRef<(() => void) | null>(null);
  return useCallback((el: HTMLElement | null) => {
    stop.current?.();
    stop.current = el ? labelOverflowTriggers(el) : null;
  }, []);
}
