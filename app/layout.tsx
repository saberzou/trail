import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import { Gelasio } from "next/font/google";
import "./globals.css";

// Body / UI text — Geist (self-hosted via the `geist` package, no network).
// Title / display text — Gelasio, a serif companion to Georgia, self-hosted by
// next/font at build time. Both are exposed as CSS variables and mapped to
// Tailwind's --font-sans / --font-serif in globals.css.
const gelasio = Gelasio({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-gelasio",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Trail",
  description: "A spatial canvas for web research trails.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html className={`${GeistSans.variable} ${gelasio.variable}`} lang="en">
      <body>{children}</body>
    </html>
  );
}
