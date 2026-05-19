/**
 * Server-wrapper för /matters/[id]. Exporterar `generateStaticParams`
 * så Next 16 kan pre-rendera statiska sidor per id i demo-builden.
 *
 * I full server-build:n returnerar `generateStaticParams` en tom
 * array och Next:n fall:er tillbaka till dynamisk rendering.
 */

import MatterDetailClient from "./_client";
import { collectDemoIds } from "@/lib/demo/static-params";

export async function generateStaticParams(): Promise<{ id: string }[]> {
  if (process.env.DEMO_BUILD !== "1") return [];
  const ids = await collectDemoIds("matters/active");
  return ids.map((id) => ({ id }));
}

export default async function MatterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MatterDetailClient id={id} />;
}
