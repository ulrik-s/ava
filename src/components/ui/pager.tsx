/**
 * `Pager` — delad pagineringsfot för list-vyer (#6-ratchet, DRY).
 *
 * Tar list-queryns `data` ({ pages, total? }) och renderar inget vid ≤1 sida.
 * `showTotal` styr om "(N totalt)" visas (kontakt-listan vill ha det, ärende-
 * listan inte) — så samma komponent bevarar båda vyernas exakta utseende utan
 * att tvinga `?.`-grenar tillbaka in i sid-komponenterna.
 */

interface PagerProps {
  data: { pages: number; total?: number } | undefined;
  page: number;
  onPage: (p: number) => void;
  /** Visa "(N totalt)" efter sidräknaren (default false). */
  showTotal?: boolean;
}

export function Pager({ data, page, onPage, showTotal = false }: PagerProps) {
  if (!data || data.pages <= 1) return null;
  const suffix = showTotal && data.total !== undefined ? ` (${data.total} totalt)` : "";
  return (
    <div className="px-6 py-3 mt-2 bg-white border border-gray-200 rounded-lg flex items-center justify-between">
      <p className="text-sm text-gray-500">Sida {page} av {data.pages}{suffix}</p>
      <div className="flex gap-2">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)}
          className="px-3 py-1 text-sm border rounded disabled:opacity-50">Föregående</button>
        <button disabled={page >= data.pages} onClick={() => onPage(page + 1)}
          className="px-3 py-1 text-sm border rounded disabled:opacity-50">Nästa</button>
      </div>
    </div>
  );
}
