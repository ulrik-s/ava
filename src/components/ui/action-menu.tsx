"use client";

/**
 * `ActionMenu` — en touch- och responsiv "overflow"-meny (kebab, ⋮).
 *
 * Varför: rader med många inline-actions blir för breda på små skärmar →
 * jobbig horisontell scroll. En kebab-knapp samlar alla actions i en
 * dropdown som funkar på ALLA skärmstorlekar och med touch (tap), till
 * skillnad mot en höger-klick-meny (finns inte på touch).
 *
 * Designval:
 *   - **Portal till `document.body`** så menyn aldrig klipps av en
 *     `overflow-x-auto`-förälder (t.ex. dokumenttabellen).
 *   - **Position beräknas vid öppning** (synkront från knappens rect) —
 *     ingen useLayoutEffect → inga SSR-varningar i static export.
 *   - **Stänger** vid utanför-klick, Escape, scroll och resize.
 *   - Items kan vara antingen `onSelect`-knappar eller `href`-länkar
 *     (Visa/Ladda ner behöver vara riktiga `<a>`).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreVertical } from "lucide-react";

export interface ActionMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  /** Knapp-action. Ignoreras om `href` är satt. */
  onSelect?: () => void;
  /** Gör item:et till en `<a href>` (för Visa/Ladda ner). */
  href?: string;
  download?: boolean;
  newTab?: boolean;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
}

interface MenuPos {
  top?: number;
  bottom?: number;
  right: number;
}

const ITEM_HEIGHT = 44;

export function ActionMenu({
  items,
  disabled,
  label = "Åtgärder",
}: {
  items: ActionMenuItem[];
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const btn = btnRef.current;
    if (btn) {
      const r = btn.getBoundingClientRect();
      const estHeight = items.length * ITEM_HEIGHT + 16;
      const right = Math.max(8, window.innerWidth - r.right);
      const openUp = r.bottom + estHeight > window.innerHeight && r.top > estHeight;
      setPos(openUp ? { bottom: window.innerHeight - r.top + 4, right } : { top: r.bottom + 4, right });
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: Event) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey);
    // OBS: lyssna UTAN capture. Med capture fångas även scroll i nästlade
    // containrar (t.ex. tabellens `overflow-x-auto` när knappen scrollas in
    // i vyn) → menyn stängdes direkt vid klick. Utan capture triggar bara
    // sid-scroll (scroll bubblar inte), vilket är det vi vill stänga på.
    window.addEventListener("scroll", close);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const handleSelect = (item: ActionMenuItem) => {
    setOpen(false);
    item.onSelect?.();
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50 touch-manipulation"
      >
        <MoreVertical size={18} />
      </button>
      {open && pos && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={label}
              style={{ position: "fixed", top: pos.top, bottom: pos.bottom, right: pos.right, zIndex: 60 }}
              className="min-w-[210px] overflow-hidden rounded-lg bg-white py-1 shadow-lg ring-1 ring-black/10"
            >
              {items.map((item) => (
                <ActionMenuRow key={item.key} item={item} onSelect={() => handleSelect(item)} />
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function ActionMenuRow({ item, onSelect }: { item: ActionMenuItem; onSelect: () => void }) {
  const cls = `flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm touch-manipulation ${
    item.danger ? "text-red-600 hover:bg-red-50" : "text-gray-700 hover:bg-gray-50"
  } ${item.disabled ? "pointer-events-none opacity-50" : ""}`;

  if (item.href !== undefined) {
    return (
      <a
        href={item.disabled ? undefined : item.href}
        role="menuitem"
        download={item.download}
        target={item.newTab ? "_blank" : undefined}
        rel={item.newTab ? "noopener noreferrer" : undefined}
        aria-disabled={item.disabled}
        title={item.title}
        className={cls}
        onClick={onSelect}
      >
        {item.icon}
        <span className="flex-1">{item.label}</span>
      </a>
    );
  }

  return (
    <button type="button" role="menuitem" disabled={item.disabled} title={item.title} className={cls} onClick={onSelect}>
      {item.icon}
      <span className="flex-1">{item.label}</span>
    </button>
  );
}
