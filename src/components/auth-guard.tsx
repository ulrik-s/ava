"use client";

import { useSession } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Sidebar } from "./sidebar";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  const isLoginPage = pathname === "/login";
  const isDev = process.env.NODE_ENV === "development";

  useEffect(() => {
    // In production, redirect to login if not authenticated
    if (status === "unauthenticated" && !isLoginPage && !isDev) {
      router.push(`/login?callbackUrl=${encodeURIComponent(pathname)}`);
    }
  }, [status, isLoginPage, isDev, router, pathname]);

  // Login page: render without sidebar
  if (isLoginPage) {
    return <>{children}</>;
  }

  // Loading state
  if (status === "loading" && !isDev) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-gray-500">Laddar...</p>
      </div>
    );
  }

  // Normal app layout with sidebar
  return (
    <div className="flex h-full">
      <Sidebar userName={session?.user?.name} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 pt-16 sm:pt-16 lg:pt-0 min-w-0">
        {children}
      </main>
    </div>
  );
}
