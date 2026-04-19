"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";

const roleLabels: Record<string, string> = {
  ADMIN: "Admin",
  LAWYER: "Advokat",
  ASSISTANT: "Assistent",
};

export default function UsersPage() {
  const users = trpc.user.list.useQuery();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Användare</h1>
        <Link
          href="/users/new"
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
        >
          + Ny användare
        </Link>
      </div>

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
                <td className="px-6 py-4 text-sm text-gray-500">{user.title || "\u2014"}</td>
                <td className="px-6 py-4 text-sm text-gray-500">{user.email}</td>
                <td className="px-6 py-4 text-sm text-gray-500">{roleLabels[user.role] || user.role}</td>
                <td className="px-6 py-4 text-sm text-gray-500">
                  {user.hourlyRate != null ? `${user.hourlyRate} kr/h` : "\u2014"}
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">
                  {user.mileageRate != null ? `${(user.mileageRate / 100).toFixed(2)} kr/km` : "\u2014"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {users.isLoading && <p className="mt-4 text-sm text-gray-500">Laddar...</p>}
      {users.error && <p className="mt-4 text-sm text-red-600">Fel: {users.error.message}</p>}
    </div>
  );
}
