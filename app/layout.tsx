import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
