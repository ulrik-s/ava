import ContactDetailClient from "./_client";
import { demoStaticParams } from "@/client/lib/demo/static-params";

export async function generateStaticParams(): Promise<{ id: string }[]> {
  return demoStaticParams("contacts");
}

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ContactDetailClient id={id} />;
}
