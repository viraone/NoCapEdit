import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ALL_FONT_CLASSES } from "@/lib/fonts";

export const metadata: Metadata = {
  title: "NoCap Edit",
  description: "Browser-native editor that turns raw recordings into captioned, platform-shaped vertical clips. Everything runs on your device.",
  applicationName: "NoCap Edit",
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
