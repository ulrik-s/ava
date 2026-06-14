/**
 * Server-wrapper för /payment-plans/[id]. Pre-renderar per-plan-shells via
 * `demoStaticParams` så static export funkar.
 */

import { demoStaticParams } from "@/lib/client/demo/static-params";
import PaymentPlanDetailClient from "./_client";

export async function generateStaticParams(): Promise<{ id: string }[]> {
  return demoStaticParams("payment-plans");
}

export default async function PaymentPlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PaymentPlanDetailClient id={id} />;
}
