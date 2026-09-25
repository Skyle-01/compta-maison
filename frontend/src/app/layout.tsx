import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "compta",
  description: "Household accounting",
};

const NAV = [
  { href: "/", label: "Tableau de bord" },
  { href: "/transactions", label: "Transactions" },
  { href: "/import", label: "Importer" },
  { href: "/settings", label: "Réglages" },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900">
        <header className="border-b border-zinc-200 bg-white">
          <nav className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-3">
            <span className="font-semibold tracking-tight">compta</span>
            {NAV.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="text-sm text-zinc-600 hover:text-zinc-900"
              >
                {label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
