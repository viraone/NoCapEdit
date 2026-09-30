/**
 * The desktop editor sets the page's base font size to 13px (globals.css),
 * which shrinks every rem-based Tailwind size: the mobile column came out
 * 364px wide on a 430px phone, with the text a notch too small. The mobile
 * route gets a normal 16px base and an all-black page so the column fills
 * the screen edge to edge.
 */
export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{`html, body { font-size: 16px; background: #000; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, system-ui, sans-serif; }`}</style>
      {children}
    </>
  );
}
