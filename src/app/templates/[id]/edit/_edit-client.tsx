"use client";

import { useRouter } from "next/navigation";
import { trpc } from "@/lib/client/trpc";
import { TemplateEditor } from "@/components/settings/template-editor";
import { useRouteId } from "@/lib/client/demo/use-route-id";

export default function EditTemplateClient({ id: paramId }: { id: string }) {
  // Static export serverar __shell__ för okända id:n → läs riktiga id:t
  // ur URL:en (faller tillbaka till build-time-param i server-mode).
  // offsetFromEnd=1 eftersom path är /templates/<id>/edit (id näst sist).
  const id = useRouteId(1) ?? paramId;
  const router = useRouter();
  const utils = trpc.useUtils();

  const template = trpc.documentTemplate.getById.useQuery({ id });

  const update = trpc.documentTemplate.update.useMutation({
    onSuccess: () => {
      utils.documentTemplate.list.invalidate();
      utils.documentTemplate.getById.invalidate({ id });
      router.push("/templates");
    },
  });

  if (template.isLoading) {
    return <div className="p-6 text-sm text-gray-500">Laddar…</div>;
  }
  if (!template.data) {
    return <div className="p-6 text-sm text-red-500">Mallen hittades inte.</div>;
  }

  return (
    <div className="p-6 flex flex-col h-full">
      <h1 className="text-xl font-bold text-gray-900 mb-4">Redigera mall</h1>
      <div className="flex-1 min-h-0">
        <TemplateEditor
          initialName={template.data.name}
          initialDescription={template.data.description ?? ""}
          initialCategory={template.data.category ?? ""}
          initialContent={template.data.content}
          onSave={(data) => update.mutate({ id, ...data })}
          onCancel={() => router.push("/templates")}
          saving={update.isPending}
        />
      </div>
      {update.error && (
        <p className="mt-2 text-sm text-red-600">{update.error.message}</p>
      )}
    </div>
  );
}
