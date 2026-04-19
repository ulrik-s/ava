"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";

export default function NewUserPage() {
  const router = useRouter();
  const utils = trpc.useUtils();

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

  const createUser = trpc.user.create.useMutation({
    onSuccess: () => {
      utils.user.list.invalidate();
      router.push("/users");
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError("");

    if (form.password !== form.confirmPassword) {
      setPasswordError("Lösenorden matchar inte");
      return;
    }

    createUser.mutate({
      name: form.name,
      email: form.email,
      role: form.role,
      title: form.title || undefined,
      hourlyRate: form.hourlyRate ? Number(form.hourlyRate) : undefined,
      mileageRate: form.mileageRate ? Math.round(Number(form.mileageRate) * 100) : undefined,
      password: form.password,
    } as Parameters<typeof createUser.mutate>[0]);
  }

  return (
    <div>
      <div className="mb-6">
        <Link href="/users" className="text-sm text-blue-600 hover:underline">&larr; Tillbaka till användare</Link>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Ny användare</h1>

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
              <label className="block text-sm font-medium text-gray-700 mb-1">Lösenord *</label>
              <input
                type="password"
                required
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bekräfta lösenord *</label>
              <input
                type="password"
                required
                value={form.confirmPassword}
                onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          {passwordError && (
            <p className="mt-2 text-sm text-red-600">{passwordError}</p>
          )}
          {createUser.error && (
            <p className="mt-2 text-sm text-red-600">{createUser.error.message}</p>
          )}

          <div className="mt-6 flex gap-3">
            <button
              type="submit"
              disabled={createUser.isPending}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {createUser.isPending ? "Sparar..." : "Skapa användare"}
            </button>
            <Link
              href="/users"
              className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50"
            >
              Avbryt
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
