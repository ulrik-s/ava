import ContactDetailClient from "./_client";
import { collectDemoIds } from "@/lib/demo/static-params";

export async function generateStaticParams(): Promise<{ id: string }[]> {
  if (process.env.DEMO_BUILD !== "1") return [];
  const ids = await collectDemoIds("contacts");
  return ids.map((id) => ({ id }));
}

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ContactDetailClient id={id} />;
}
