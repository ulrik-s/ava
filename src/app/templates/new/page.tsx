"use client";

import { useRouter } from "next/navigation";
import { trpc } from "@/lib/client/trpc";
import { TemplateEditor } from "@/components/settings/template-editor";

export default function NewTemplatePage() {
  const router = useRouter();
  const utils = trpc.useUtils();

  const create = trpc.documentTemplate.create.useMutation({
    onSuccess: () => {
      utils.documentTemplate.list.invalidate();
      router.push("/templates");
    },
  });

  return (
    <div className="p-6 flex flex-col h-full">
      <h1 className="text-xl font-bold text-gray-900 mb-4">Ny dokumentmall</h1>
      <div className="flex-1 min-h-0">
        <TemplateEditor
          onSave={(data) => create.mutate(data)}
          onCancel={() => router.push("/templates")}
          saving={create.isPending}
        />
      </div>
      {create.error && (
        <p className="mt-2 text-sm text-red-600">{create.error.message}</p>
      )}
    </div>
  );
}
