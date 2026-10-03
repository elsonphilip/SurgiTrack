import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "SurgiTrack",
  description: "Hand-stability training and tremor tracking for surgeons in training.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <header className="border-b border-line bg-surface">
          <nav className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3 text-sm">
            <Link href="/" className="text-base font-semibold tracking-tight">
              SurgiTrack
            </Link>
            <Link href="/" className="text-ink2 hover:text-ink">Profiles</Link>
            <Link href="/leaderboard" className="text-ink2 hover:text-ink">Leaderboard</Link>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
        <footer className="mx-auto w-full max-w-5xl px-4 py-6 text-xs text-muted">
          Training tool only. Not a medical device — tremor indicators are not a diagnosis.
        </footer>
      </body>
    </html>
  );
}
