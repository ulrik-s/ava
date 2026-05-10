"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { UserForm, type UserFormState } from "../_user-form";

const roleLabels: Record<string, string> = {
  ADMIN: "Admin",
  LAWYER: "Advokat",
  ASSISTANT: "Assistent",
};

export default function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const utils = trpc.useUtils();
  const user = trpc.user.getById.useQuery({ id });

  const [form, setForm] = useState<UserFormState>({
    name: "",
    title: "",
    email: "",
    role: "LAWYER",
    hourlyRate: "",
    mileageRate: "",
    password: "",
    confirmPassword: "",
  });
  const [passwordError, setPasswordError] = useState("");
  const [initialized, setInitialized] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (user.data && !initialized) {
      setForm({
        name: user.data.name,
        title: user.data.title ?? "",
        email: user.data.email,
        role: user.data.role,
        hourlyRate: user.data.hourlyRate != null ? String(user.data.hourlyRate) : "",
        mileageRate: user.data.mileageRate != null ? String(user.data.mileageRate / 100) : "",
        password: "",
        confirmPassword: "",
      });
      setInitialized(true);
    }
  }, [user.data, initialized]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const updateUser = trpc.user.update.useMutation({
    onSuccess: () => {
      utils.user.list.invalidate();
      utils.user.getById.invalidate({ id });
      router.push("/users");
    },
  });

  const deleteUser = trpc.user.delete.useMutation({
    onSuccess: () => {
      utils.user.list.invalidate();
      router.push("/users");
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError("");

    if (form.password && form.password !== form.confirmPassword) {
      setPasswordError("Lösenorden matchar inte");
      return;
    }

    updateUser.mutate({
      id,
      name: form.name,
      email: form.email,
      role: form.role,
      title: form.title || undefined,
      hourlyRate: form.hourlyRate ? Number(form.hourlyRate) : undefined,
      mileageRate: form.mileageRate ? Math.round(Number(form.mileageRate) * 100) : undefined,
      password: form.password || undefined,
    } as Parameters<typeof updateUser.mutate>[0]);
  }

  function handleDelete() {
    if (!confirm("Är du säker på att du vill ta bort denna användare?")) return;
    deleteUser.mutate({ id });
  }

  if (user.isLoading) return <p className="text-gray-500">Laddar...</p>;
  if (user.error) return <p className="text-red-600">Fel: {user.error.message}</p>;
  if (!user.data) return null;

  return (
    <div>
      <div className="mb-6">
        <Link href="/users" className="text-sm text-blue-600 hover:underline">&larr; Tillbaka till användare</Link>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Redigera användare</h1>
          <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
            {roleLabels[user.data.role] || user.data.role}
          </span>
        </div>

        <UserForm
          form={form}
          setForm={setForm}
          onSubmit={handleSubmit}
          passwordError={passwordError}
          errorMessage={updateUser.error?.message}
          passwordRequired={false}
          passwordPlaceholder="Lämna tomt för att behålla nuvarande"
          submitLabel="Spara"
          submittingLabel="Sparar..."
          isSubmitting={updateUser.isPending}
          extraActions={
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleteUser.isPending}
              className="px-4 py-2 border border-red-300 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 disabled:opacity-50"
            >
              {deleteUser.isPending ? "Tar bort..." : "Ta bort"}
            </button>
          }
        />
      </div>
    </div>
  );
}
