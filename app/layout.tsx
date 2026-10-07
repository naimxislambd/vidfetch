import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VidFetch — Free Video & Reels Downloader",
  description:
    "Download long videos and reels from YouTube, Facebook, X and TikTok — including private and group Facebook videos. Free, no signup.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
