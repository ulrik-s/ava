"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";

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

  const [form, setForm] = useState({
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

        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Namn *</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Titel</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">E-post *</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Roll</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="ADMIN">Admin</option>
                <option value="LAWYER">Advokat</option>
                <option value="ASSISTANT">Assistent</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Timtaxa (kr/h)</label>
              <input
                type="number"
                value={form.hourlyRate}
                onChange={(e) => setForm({ ...form, hourlyRate: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Milersättning (kr/km)</label>
              <input
                type="number"
                step="0.01"
                value={form.mileageRate}
                onChange={(e) => setForm({ ...form, mileageRate: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nytt lösenord</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Lämna tomt för att behålla nuvarande"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bekräfta lösenord</label>
              <input
                type="password"
                value={form.confirmPassword}
                onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          {passwordError && (
            <p className="mt-2 text-sm text-red-600">{passwordError}</p>
          )}
          {updateUser.error && (
            <p className="mt-2 text-sm text-red-600">{updateUser.error.message}</p>
          )}

          <div className="mt-6 flex items-center justify-between">
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={updateUser.isPending}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {updateUser.isPending ? "Sparar..." : "Spara"}
              </button>
              <Link
                href="/users"
                className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50"
              >
                Avbryt
              </Link>
            </div>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleteUser.isPending}
              className="px-4 py-2 border border-red-300 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 disabled:opacity-50"
            >
              {deleteUser.isPending ? "Tar bort..." : "Ta bort"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
