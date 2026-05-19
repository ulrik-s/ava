"use client";

import { useSession } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Sidebar } from "./sidebar";

/**
 * Demo-build: ingen NextAuth-backend finns, ingen sidebar/sidopanel
 * passar, och alla "auth-skyddade" sidor ska bara fungera read-only
 * mot DemoDataStore. Gated via build-time env var som expanderas
 * i client-bundlen (kräver NEXT_PUBLIC_-prefix).
 */
const IS_DEMO_BUILD = process.env.NEXT_PUBLIC_DEMO_BUILD === "1";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  const isLoginPage = pathname === "/login";
  const isDev = process.env.NODE_ENV === "development";
  const isDemoPath = pathname === "/demo" || pathname.startsWith("/demo/");

  useEffect(() => {
    if (IS_DEMO_BUILD) return;
    if (isDemoPath) return;
    // In production, redirect to login if not authenticated
    if (status === "unauthenticated" && !isLoginPage && !isDev) {
      router.push(`/login?callbackUrl=${encodeURIComponent(pathname)}`);
    }
  }, [status, isLoginPage, isDev, isDemoPath, router, pathname]);

  // Demo-build: ingen sidebar, ingen auth-redirect. Bara children.
  if (IS_DEMO_BUILD) {
    return <>{children}</>;
  }

  // /demo-rutten har inget med auth att göra ens i full build:n.
  if (isDemoPath) {
    return <>{children}</>;
  }

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
