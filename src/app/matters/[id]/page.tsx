/**
 * Server-wrapper för /matters/[id]. Exporterar `generateStaticParams`
 * så Next 16 kan pre-rendera statiska sidor per id i demo-builden.
 *
 * I full server-build:n returnerar `generateStaticParams` en tom
 * array och Next:n fall:er tillbaka till dynamisk rendering.
 */

import MatterDetailClient from "./_client";
import { demoStaticParams } from "@/client/lib/demo/static-params";

export async function generateStaticParams(): Promise<{ id: string }[]> {
  return demoStaticParams("matters/active");
}

export default async function MatterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MatterDetailClient id={id} />;
}
