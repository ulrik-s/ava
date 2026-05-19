import InvoiceDetailClient from "./_client";

// Demo har inga faktura-fixtures. Returnera en placeholder så static
// export inte klagar; pageen kommer rendera "Fakturan hittades inte".
export async function generateStaticParams(): Promise<{ id: string }[]> {
  return [{ id: "placeholder" }];
}

export const dynamicParams = false;

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InvoiceDetailClient id={id} />;
}
