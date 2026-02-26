import type { Metadata, Viewport } from "next";
import "./globals.css";
import PwaRegister from "./pwa-register";

export const metadata: Metadata = {
  metadataBase: new URL("https://testr.noetic.studio"),
  title: {
    default: "QA Swipe Console",
    template: "%s | QA Swipe Console",
  },
  description:
    "Tinder-style QA test execution and reporting for JSON test suites.",
  applicationName: "QA Swipe Console",
  alternates: {
    canonical: "/",
  },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { url: "/icons/icon.svg", type: "image/svg+xml" },
    ],
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
    shortcut: [{ url: "/favicon.ico" }],
  },
  appleWebApp: {
    capable: true,
    title: "QA Swipe Console",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#66c4c1",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
