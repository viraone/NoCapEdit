import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ALL_FONT_CLASSES } from "@/lib/fonts";
import { withBase } from "@/lib/basePath";

export const metadata: Metadata = {
  title: "NoCap Edit",
  description: "Browser-native editor that turns raw recordings into captioned, platform-shaped vertical clips. Everything runs on your device.",
  applicationName: "NoCap Edit",
  icons: {
    icon: [
      { url: withBase("/favicon.ico"), sizes: "16x16 32x32 48x48" },
      { url: withBase("/icon-192.png"), sizes: "192x192", type: "image/png" },
    ],
    apple: withBase("/apple-touch-icon.png"),
  },
  manifest: withBase("/manifest.webmanifest"),
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full text-white">
        {children}
        {/* Keeps every caption font in the CSS bundle so canvas text can use them. */}
        <div aria-hidden className="hidden">
          {ALL_FONT_CLASSES.map((c) => (
            <span key={c} className={c} />
          ))}
        </div>
      </body>
    </html>
  );
}
