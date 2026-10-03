import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { Splash } from "@/components/Splash";
import { SPLASH_COOKIE, pickQuote } from "@/lib/quotes";

export const metadata: Metadata = {
  title: "SurgiTrack",
  description: "Hand-stability training and tremor tracking for surgeons in training.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const showSplash = !(await cookies()).get(SPLASH_COOKIE);
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Montserrat:wght@700;800&family=Karla:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {showSplash && <Splash quote={pickQuote()} />}
        {children}
      </body>
    </html>
  );
}
