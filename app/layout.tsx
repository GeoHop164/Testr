import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QA Swipe Console",
  description: "Tinder-style QA test execution and reporting",
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
