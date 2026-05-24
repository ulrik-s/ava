"use client";

import Link from "next/link";
import { trpc } from "@/client/lib/trpc";
import { ShieldAlert, UserX } from "lucide-react";

const roleLabels: Record<string, string> = {
  ADMIN: "Admin",
  LAWYER: "Advokat",
  ASSISTANT: "Assistent",
};

export default function UsersPage() {
  const me = trpc.user.current.useQuery();
  const users = trpc.user.list.useQuery();
  const utils = trpc.useUtils();
  const deactivate = trpc.user.deactivate.useMutation({
    onSuccess: () => utils.user.list.invalidate(),
  });

  const isAdmin = me.data?.role === "ADMIN";

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Användare</h1>
        {isAdmin && (
          <Link
            href="/users/new"
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            + Ny användare
          </Link>
        )}
      </div>

      {!isAdmin && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-900 flex items-center gap-2">
          <ShieldAlert size={16} /> Endast administratörer kan skapa eller inaktivera användare.
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Namn</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Titel</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">E-post</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Roll</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Timtaxa</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Milersättning</th>
              {isAdmin && <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.data?.users.map((user) => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="px-6 py-4">
                  <Link href={`/users/${user.id}`} className="text-sm font-medium text-blue-600 hover:underline">
                    {user.name}
                  </Link>
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">{user.title || "—"}</td>
                <td className="px-6 py-4 text-sm text-gray-500">{user.email}</td>
                <td className="px-6 py-4 text-sm text-gray-500">{roleLabels[user.role] || user.role}</td>
                <td className="px-6 py-4 text-sm text-gray-500">
                  {user.hourlyRate != null ? `${user.hourlyRate} kr/h` : "—"}
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">
                  {user.mileageRate != null ? `${(user.mileageRate / 100).toFixed(2)} kr/km` : "—"}
                </td>
                {isAdmin && (
                  <td className="px-6 py-4 text-right">
                    {user.id !== me.data?.id && (
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Inaktivera ${user.name}? Användaren kan inte längre logga in men historik bevaras.`)) {
                            deactivate.mutate({ id: user.id });
                          }
                        }}
                        className="text-xs text-gray-400 hover:text-red-600 inline-flex items-center gap-1"
                        title="Inaktivera"
                      >
                        <UserX size={12} /> Inaktivera
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {users.isLoading && <p className="mt-4 text-sm text-gray-500">Laddar...</p>}
      {users.error && <p className="mt-4 text-sm text-red-600">Fel: {users.error.message}</p>}
      {deactivate.error && <p className="mt-4 text-sm text-red-600">{deactivate.error.message}</p>}
    </div>
  );
}
