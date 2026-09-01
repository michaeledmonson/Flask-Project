import type { Metadata, Viewport } from "next";
import Link from "next/link";

import "./globals.css";

export const metadata: Metadata = {
  title: "Is My Food Safe?",
  description:
    "Current risk levels for US grocery items and restaurant chains, from federal recall feeds and news reporting.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-stone-50 text-stone-900 antialiased">
        <div className="mx-auto flex min-h-screen w-full max-w-[640px] flex-col">
          <main className="flex-1">{children}</main>
          <footer className="mt-10 border-t border-stone-200 px-4 py-6 text-xs text-stone-500">
            <p>
              Informational only — not medical or food-safety advice. Always verify
              against the linked official notices.
            </p>
            <p className="mt-2">
              <Link href="/about" className="font-medium text-stone-700 underline">
                How this works
              </Link>
            </p>
          </footer>
        </div>
      </body>
    </html>
  );
}
