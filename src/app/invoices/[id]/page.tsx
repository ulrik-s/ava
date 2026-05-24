import InvoiceDetailClient from "./_client";
import { SHELL_PARAM } from "@/client/lib/demo/static-params";

// Static export: en sentinel-shell som nginx serverar för godtyckliga
// faktura-id:n (self-hosted). Klienten läser riktiga id:t via useRouteId().
// Real backend (Postgres) bygger sidor dynamiskt (dynamicParams=true default).
export async function generateStaticParams(): Promise<{ id: string }[]> {
  return [{ id: SHELL_PARAM }];
}

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InvoiceDetailClient id={id} />;
}
