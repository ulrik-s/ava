import { demoStaticParams } from "@/lib/client/demo/static-params";
import EditTemplateClient from "./_edit-client";

// Static export: pre-rendera 1 HTML per seed-mall + sentinel-shell.
// Tidigare stashades hela templates/[id] bort → klick "Redigera mall"
// gav 404 → SPA-fallback-loop.
export async function generateStaticParams(): Promise<{ id: string }[]> {
  return demoStaticParams(".ava/templates");
}

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditTemplateClient id={id} />;
}
