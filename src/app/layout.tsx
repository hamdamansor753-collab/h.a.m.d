import type { Metadata } from "next";
import { Cairo } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/components/hamd/auth-provider";

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "H.A.M.D ERP",
  description: "H.A.M.D ERP — Multi-tenant Enterprise Resource Planning for the Arab market",
  keywords: ["H.A.M.D", "ERP", "accounting", "multi-tenant", "Arabic"],
  authors: [{ name: "H.A.M.D" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body
        className={`${cairo.variable} font-cairo antialiased bg-background text-foreground min-h-screen flex flex-col`}
      >
        <AuthProvider>
          {children}
        </AuthProvider>
        <Toaster />
        <SonnerToaster position="top-center" />
      </body>
    </html>
  );
}
