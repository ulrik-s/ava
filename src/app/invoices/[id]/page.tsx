import InvoiceDetailClient from "./_client";

// Demo (static export) har inga faktura-fixtures men behöver en placeholder
// så Next:s build inte klagar. Real backend (Postgres) bygger sina sidor
// dynamiskt → `dynamicParams = true` (default) krävs så riktiga id:n inte
// 404:ar. Tidigare `false` blockerade ALLA id:n utom "placeholder", vilket
// gjorde att Öppna-länken på en faktura ledde till 404 i full-mode.
export async function generateStaticParams(): Promise<{ id: string }[]> {
  return [{ id: "placeholder" }];
}

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InvoiceDetailClient id={id} />;
}
