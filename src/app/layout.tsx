import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Monopoly Online",
  description: "Multiplayer Monopoly-style board game",
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
