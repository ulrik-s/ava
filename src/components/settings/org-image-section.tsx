"use client";

/**
 * `OrgImageSection` — ladda upp / byt / ta bort en av byråns bilder (logga,
 * sidfotsmärke) för genererade dokument (#1218).
 *
 * Bilden läses i webbläsaren till en data-URL och valideras mot
 * `orgImageSchema` (PNG/JPEG, ≤ 300 kB) innan den sparas på organisationen —
 * samma schema som servern tolkar med, så ett fel syns direkt här.
 */

import { Building2, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { orgImageSchema, type OrgImage } from "@/lib/shared/org-image";

/** Läs en fil till en data-URL. */
export function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Kunde inte läsa filen"));
    reader.readAsDataURL(file);
  });
}

/** Tolka en uppladdad fil som byråbild — bilden eller ett felmeddelande. */
export async function parseOrgImageFile(file: Blob): Promise<{ image: OrgImage } | { error: string }> {
  const parsed = orgImageSchema.safeParse(await readFileAsDataUrl(file));
  return parsed.success ? { image: parsed.data } : { error: parsed.error.issues[0]?.message ?? "Ogiltig bild" };
}

interface Props {
  title: string;
  description: string;
  value: OrgImage | null;
  /** Spara en ny bild (eller `null` = ta bort). */
  onChange: (image: OrgImage | null) => void;
}

export function OrgImageSection({ title, description, value, onChange }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const onFile = async (file: File): Promise<void> => {
    const result = await parseOrgImageFile(file);
    if ("error" in result) return setError(result.error);
    setError(null);
    onChange(result.image);
  };
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-5">
      <div className="flex items-center gap-2 mb-4">
        <Building2 size={16} className="text-gray-500" />
        <h3 className="font-semibold text-gray-900">{title}</h3>
      </div>
      <p className="text-xs text-gray-500 mb-4">{description} PNG eller JPEG, max 300 kB.</p>
      <div className="flex items-center gap-4">
        <div className="w-40 h-20 border border-gray-200 rounded flex items-center justify-center bg-gray-50 shrink-0 overflow-hidden">
          {value
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={value} alt={title} className="max-h-full max-w-full object-contain p-2" />
            : <span className="text-xs text-gray-400">Ingen bild</span>}
        </div>
        <div className="flex flex-col gap-2">
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg" className="hidden" aria-label={`${title} — välj fil`}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
              e.target.value = "";
            }} />
          <button type="button" onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">
            <Upload size={14} /> {value ? "Byt bild" : "Ladda upp"}
          </button>
          {value && (
            <button type="button" onClick={() => onChange(null)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm border border-red-200 text-red-600 rounded hover:bg-red-50">
              <Trash2 size={14} /> Ta bort
            </button>
          )}
        </div>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
