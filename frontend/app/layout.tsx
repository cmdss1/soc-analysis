import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SOC Kasm Sandbox",
  description: "URL investigations with Kasm Chrome + MITM visibility",
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
