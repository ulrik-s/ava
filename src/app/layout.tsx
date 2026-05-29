import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/shell/providers";
import { PwaRegister } from "@/components/shell/pwa-register";
import { ThemeRestore } from "@/components/shell/theme-restore";
import { ThemeToggle } from "@/components/shell/theme-toggle";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AVA — Advokat CRM",
  description: "CRM-system för advokatbyråer",
  // basePath-prefix bakas in vid build (DEMO_BASE_PATH=/ava i demon).
  // Next.js Metadata-API:t lägger INTE automatiskt till basePath på
  // manifest-URL:n, så vi gör det manuellt.
  manifest: `${process.env.NEXT_PUBLIC_DEMO_BASE_PATH ?? ""}/manifest.json`,
  appleWebApp: {
    capable: true,
    title: "AVA",
    statusBarStyle: "default",
  },
};

export const viewport = {
  themeColor: "#2563eb",
  // Säkerställ korrekt mobil-rendering — initial-scale=1 + viewport-fit för
  // notch på iPhone. Användaren kan zooma (utan user-scalable=no).
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="sv"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Sätt .dark på <html> INNAN React hydrerar → undviker FOUC från
            ljust → mörkt vid sidladdning för användare som valt dark mode. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('ava.theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="h-full bg-gray-50">
        <ThemeRestore />
        <ThemeToggle />
        <PwaRegister />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
