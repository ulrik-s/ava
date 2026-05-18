import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AuthGuard } from "@/components/auth-guard";
import { PwaRegister } from "@/components/pwa-register";

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
  manifest: "/manifest.json",
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
    >
      <body className="h-full bg-gray-50">
        <PwaRegister />
        <Providers>
          <AuthGuard>
            {children}
          </AuthGuard>
        </Providers>
      </body>
    </html>
  );
}
