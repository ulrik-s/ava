"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/client/trpc";
import { UserForm, type UserFormState } from "../_user-form";

export default function NewUserPage() {
  const router = useRouter();
  const utils = trpc.useUtils();

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

        <UserForm
          form={form}
          setForm={setForm}
          onSubmit={handleSubmit}
          passwordError={passwordError}
          errorMessage={createUser.error?.message}
          passwordRequired={true}
          submitLabel="Skapa användare"
          submittingLabel="Sparar..."
          isSubmitting={createUser.isPending}
        />
      </div>
    </div>
  );
}
