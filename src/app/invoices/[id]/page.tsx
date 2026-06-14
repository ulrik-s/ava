import { demoStaticParams } from "@/lib/client/demo/static-params";
import InvoiceDetailClient from "./_client";

// Static export: pre-rendera 1 HTML per seed-faktura PLUS sentinel-shell
// (för self-hosted nya id:n). Tidigare returnerades bara SHELL_PARAM →
// direktlänkar som /invoices/inv-001/ gav 404 → SPA-fallback loopade.
export async function generateStaticParams(): Promise<{ id: string }[]> {
  return demoStaticParams("invoices");
}

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InvoiceDetailClient id={id} />;
}
