import { demoStaticParamsBySeedId } from "@/lib/client/demo/static-params";
import EditUserClient from "./_edit-client";

// Static export: pre-rendera 1 HTML per seed-user + sentinel-shell.
// Users-filerna namnges på email men route-id:t är user.id (u-anna) →
// vi läser seed-objektens id direkt (inte filnamnet).
export async function generateStaticParams(): Promise<{ id: string }[]> {
  return demoStaticParamsBySeedId("users");
}

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditUserClient id={id} />;
}
